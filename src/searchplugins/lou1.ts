import crypto from "crypto";

import * as cheerio from "cheerio";

import {
  BasePlugin,
  cleanHTML,
  convertDiskType,
  deduplicateResults,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  fetchWithTimeout,
  filterByKeyword,
  generateUniqueID,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://www.1lou.me";
const SEARCH_LIMIT = 12;
const DETAIL_WORKERS = 6;

// Link patterns with regex and type
const linkPatterns: Array<{ reg: RegExp; typ: CloudType | "magnet" | "ed2k" }> =
  [
    { reg: /https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z]+/, typ: "quark" },
    { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_?=&]+/, typ: "baidu" },
    {
      reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_?=&]+/,
      typ: "xunlei",
    },
    {
      reg: /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/,
      typ: "aliyun",
    },
    { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, typ: "uc" },
    {
      reg: /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/,
      typ: "123",
    },
    {
      reg: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/,
      typ: "pikpak",
    },
    { reg: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, typ: "magnet" },
    { reg: /ed2k:\/\/[^\s<>"']+/, typ: "ed2k" },
  ];

const passwordPatterns: RegExp[] = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const textURLRegex = /https?:\/\/[^\s<>"']+/g;
const threadIDRegex = /thread-(\d+)/;

class Lou1Plugin extends BasePlugin {
  constructor() {
    super("lou1", 1);
  }

  /**
   * Search for resources
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchKeyword = keyword.trim();
    if (!searchKeyword) {
      throw new Error(`[${this.name}] keyword cannot be empty`);
    }

    // 1. Fetch search results page
    const threads = await this._fetchSearchResults(searchKeyword);
    if (threads.length === 0) {
      return [];
    }

    // 2. Fetch detail pages concurrently with limited concurrency
    const results: SearchResult[] = [];
    const semaphore = { count: 0, max: DETAIL_WORKERS };

    const tasks = threads.map(async (thread) => {
      // Simple semaphore
      while (semaphore.count >= semaphore.max) {
        await new Promise((r) => setTimeout(r, 50));
      }
      semaphore.count++;

      try {
        const detail = await this._fetchDetail(thread.url);
        if (!detail || detail.links.length === 0) {
          return;
        }

        const content = thread.summary || detail.description;

        results.push({
          uniqueId: this._buildUniqueID(thread.url),
          title: thread.title,
          content: (content || "").trim(),
          links: detail.links,
          datetime: detail.datetime || "",
          tags: this._mergeTags(thread.tags, detail.tags),
          channel: "",
        });
      } catch (e) {
        // ignore errors
      } finally {
        semaphore.count--;
      }
    });

    await Promise.all(tasks);

    return filterByKeyword(results, searchKeyword);
  }

  /**
   * Fetch search results page
   */
  async _fetchSearchResults(
    keyword: string,
  ): Promise<
    Array<{ title: string; url: string; tags: string[]; summary: string }>
  > {
    const encodedKeyword = this._encodeKeyword(keyword);
    const searchURL = `${BASE_URL}/search-${encodedKeyword}.htm`;

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      Referer: BASE_URL,
    };

    const resp = await fetchWithRetry(
      searchURL,
      { headers },
      { timeout: 30000, retries: 2 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    const threads: Array<{
      title: string;
      url: string;
      tags: string[];
      summary: string;
    }> = [];
    $("ul.threadlist li.thread").each((_, el) => {
      if (threads.length >= SEARCH_LIMIT) {
        return;
      }

      const li = $(el);
      const subject = li.find(".subject a").first();
      const href = subject.attr("href");
      if (!href || !href.trim()) {
        return;
      }

      const title = subject.text().trim();
      if (!title) {
        return;
      }

      // Only include results containing '夸克'
      if (!title.includes("夸克")) {
        return;
      }

      const threadURL = this._toAbsoluteURL(href);

      const tags: string[] = [];
      li.find(".subject a.badge").each((_, tagNode) => {
        const tag = $(tagNode).text().trim();
        if (tag) {
          tags.push(tag);
        }
      });

      const summary = li.find("p.note").text().trim();

      threads.push({ title, url: threadURL, tags, summary });
    });

    return threads;
  }

  /**
   * Fetch a detail page
   */
  async _fetchDetail(detailURL: string): Promise<{
    links: Link[];
    datetime: string;
    tags: string[];
    description: string;
  } | null> {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      Referer: BASE_URL,
    };

    const resp = await fetchWithRetry(
      detailURL,
      { headers },
      { timeout: 30000, retries: 2 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Find main content
    let content: any = $('div.message[isfirst="1"]');
    if (content.length === 0) {
      content = $(".message");
    }
    if (content.length === 0) {
      content = $.root();
    }

    // Remove script/style
    content.find("script, style").remove();

    // Extract links
    let links = this._extractLinksFromSelection($, content);
    // Filter to quark only
    links = links.filter((l) => l.type === "quark");

    // Extract description
    let description = $('meta[name="description"]').attr("content") || "";
    description = description.trim();
    if (!description) {
      description = content.text().trim().substring(0, 200);
    }

    // Collect tags
    const tags = this._collectDetailTags($);

    // Extract datetime
    const datetime = this._extractPostDatetime($);

    return { links, datetime, tags, description };
  }

  /**
   * Extract links from HTML selection (both href and text)
   */
  _extractLinksFromSelection($: any, sel: any): Link[] {
    const results: Link[] = [];
    const seen = new Set<string>();

    // From <a> href attributes
    sel.find("a[href]").each((_: unknown, node: cheerio.Element) => {
      const href = $(node).attr("href");
      if (!href) {
        return;
      }

      const { type, normalized } = this._classifyLink(href);
      if (!type || !normalized) {
        return;
      }
      if (seen.has(normalized)) {
        return;
      }

      const password = this._extractPasswordFromNode($, $(node));
      results.push({ type, url: normalized, password });
      seen.add(normalized);
    });

    // From text content
    const text = sel.text();
    textURLRegex.lastIndex = 0;
    let match: RegExpExecArray | null = textURLRegex.exec(text);
    while (match !== null) {
      const raw = match[0];
      const { type, normalized } = this._classifyLink(raw);
      if (!type) {
        match = textURLRegex.exec(text);
        continue;
      }
      if (seen.has(normalized)) {
        match = textURLRegex.exec(text);
        continue;
      }

      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + match[0].length + 80);
      const context = text.substring(start, end);
      const password = this._matchPassword(context);

      results.push({ type, url: normalized, password });
      seen.add(normalized);
      match = textURLRegex.exec(text);
    }

    return results;
  }

  _classifyLink(raw: string): {
    type: CloudType | "";
    normalized: string;
  } {
    raw = raw.trim();
    if (!raw) {
      return { type: "", normalized: "" };
    }

    for (const pattern of linkPatterns) {
      const match = pattern.reg.exec(raw);
      if (match) {
        let typ: CloudType | "" = "";
        if (pattern.typ === "magnet" || pattern.typ === "ed2k") {
          typ = "others";
        } else {
          typ = pattern.typ as CloudType;
        }
        return { type: typ, normalized: match[0] };
      }
    }
    return { type: "", normalized: "" };
  }

  _extractPasswordFromNode($: any, node: any): string {
    const candidates = [node.text()];

    const title = node.attr("title");
    if (title) {
      candidates.push(title);
    }

    const parent = node.parent();
    if (parent && parent.length > 0) {
      candidates.push(parent.text());
      const next = parent.next();
      if (next.length > 0) {
        candidates.push(next.text());
      }
    }

    const sibling = node.next();
    if (sibling.length > 0) {
      candidates.push(sibling.text());
    }

    for (const text of candidates) {
      const pwd = this._matchPassword(text);
      if (pwd) {
        return pwd;
      }
    }
    return "";
  }

  _matchPassword(text: string): string {
    text = (text || "").trim();
    if (!text) {
      return "";
    }
    for (const pattern of passwordPatterns) {
      const match = pattern.exec(text);
      if (match && match.length > 1) {
        return match[1].trim();
      }
    }
    return "";
  }

  _collectDetailTags($: any): string[] {
    const tagSet = new Set<string>();
    $(".breadcrumb a, ol.breadcrumb a").each(
      (_: unknown, el: cheerio.Element) => {
        const text = $(el).text().trim();
        if (text && text !== "首页") {
          tagSet.add(text);
        }
      },
    );
    $("h4 a.badge").each((_: unknown, el: cheerio.Element) => {
      const text = $(el).text().trim();
      if (text) {
        tagSet.add(text);
      }
    });
    return Array.from(tagSet);
  }

  _extractPostDatetime($: any): string {
    const dateText = $(".card-thread span.date").first().text().trim();
    // Return raw text (Node.js doesn't need time.Time parsing)
    return dateText || "";
  }

  /**
   * Encode keyword for 1lou search URL: each byte becomes _XX (uppercase hex)
   */
  _encodeKeyword(keyword: string): string {
    keyword = keyword.trim();
    if (!keyword) {
      return "";
    }

    const buf = Buffer.from(keyword, "utf8");
    let result = "";
    for (const b of buf) {
      result += "_" + b.toString(16).toUpperCase().padStart(2, "0");
    }
    return result;
  }

  _toAbsoluteURL(href: string): string {
    href = (href || "").trim();
    if (!href) {
      return "";
    }
    if (href.startsWith("http")) {
      return href;
    }
    if (href.startsWith("//")) {
      return "https:" + href;
    }
    return `${BASE_URL}/${href.replace(/^\.\//, "")}`;
  }

  _mergeTags(a: string[], b: string[]): string[] {
    const set = new Set<string>();
    (a || []).forEach((t) => {
      if (t.trim()) {
        set.add(t.trim());
      }
    });
    (b || []).forEach((t) => {
      if (t.trim()) {
        set.add(t.trim());
      }
    });
    return Array.from(set);
  }

  _buildUniqueID(detailURL: string): string {
    const match = threadIDRegex.exec(detailURL);
    let id = match ? match[1] : "";
    if (!id) {
      // CRC32 equivalent - use simple hash
      const hash = crypto
        .createHash("md5")
        .update(detailURL)
        .digest("hex")
        .slice(0, 8);
      id = parseInt(hash, 16).toString();
    }
    return `${this.name}-${id}`;
  }
}

export default Lou1Plugin;
