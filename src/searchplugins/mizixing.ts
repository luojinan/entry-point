import * as cheerio from 'cheerio';
import crypto from "crypto";
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

const BASE_URL = "https://mizixing.com";
const SEARCH_LIMIT = 12;
const DETAIL_WORKERS = 6;

interface LinkPattern {
  reg: RegExp;
  typ: string;
}

interface PasswordPattern extends RegExp {}

const linkPatterns: LinkPattern[] = [
  { reg: /https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z]+/, typ: "quark" },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_?=&]+/, typ: "baidu" },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_?=&]+/, typ: "xunlei" },
  {
    reg: /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/,
    typ: "aliyun",
  },
  { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, typ: "uc" },
  {
    reg: /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/,
    typ: "123",
  },
  { reg: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/, typ: "pikpak" },
  { reg: /https?:\/\/caiyun\.139\.com\/[^\s<>"']+/, typ: "mobile" },
  { reg: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, typ: "magnet" },
  { reg: /ed2k:\/\/[^\s<>"']+/, typ: "ed2k" },
];

const passwordPatterns: PasswordPattern[] = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const textURLRegex = /https?:\/\/[^\s<>"']+/g;

interface SearchItem {
  title: string;
  url: string;
  category: string;
  summary: string;
}

interface DetailData {
  links: Link[];
  datetime: string;
  tags: string[];
  description: string;
}

interface Semaphore {
  count: number;
  max: number;
}

class MizixingPlugin extends BasePlugin {
  constructor() {
    super("mizixing", 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchKeyword = keyword.trim();
    if (!searchKeyword)
      throw new Error(`[${this.name}] keyword cannot be empty`);

    // 1. Fetch search results page
    const items = await this._fetchSearchResults(searchKeyword);
    if (items.length === 0) return [];

    // 2. Fetch detail pages concurrently
    const results: SearchResult[] = [];
    const semaphore: Semaphore = { count: 0, max: DETAIL_WORKERS };

    const tasks = items.map(async (item) => {
      while (semaphore.count >= semaphore.max) {
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      semaphore.count++;

      try {
        const detail = await this._fetchDetailData(item.url);
        if (!detail || detail.links.length === 0) return;

        const content = item.summary || detail.description;

        results.push({
          uniqueId: this._buildUniqueID(item.url),
          title: item.title,
          content: (content || "").trim(),
          links: detail.links,
          datetime: detail.datetime || "",
          tags: this._mergeTags(item.category, detail.tags),
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

  async _fetchSearchResults(keyword: string): Promise<SearchItem[]> {
    const searchURL = `${BASE_URL}/?s=${encodeURIComponent(keyword)}`;

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
      { timeout: 12000, retries: 2 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    const items: SearchItem[] = [];
    $("article.excerpt").each((_, el) => {
      if (items.length >= SEARCH_LIMIT) return;

      const s = $(el);
      const titleNode = s.find("h2 a");
      const urlStr = titleNode.attr("href");
      if (!urlStr || !urlStr.trim()) return;

      const category = s.find("header .label").text().trim();
      const summary = s.find("p.note").text().trim();
      let title = titleNode.text().trim();
      if (!title) title = s.find("h2").text().trim();

      items.push({
        title,
        url: this._normalizeURL(urlStr),
        category,
        summary,
      });
    });

    return items;
  }

  async _fetchDetailData(detailURL: string): Promise<DetailData | null> {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      Referer: detailURL,
    };

    const resp = await fetchWithRetry(
      detailURL,
      { headers },
      { timeout: 10000, retries: 2 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Find content
    let content = $("article.article-content");
    if (content.length === 0) content = $(".article-content");
    if (content.length === 0) content = $(".entry-content");
    if (content.length === 0) content = $.root();

    // Remove unnecessary elements
    content
      .find(
        "script, style, .bdsharebuttonbox, #respond, .post-views, .share, .relates",
      )
      .remove();

    // Extract links
    const links = this._extractLinksFromSelection($, content);

    // Extract description
    const description = $('meta[name="description"]').attr("content") || "";

    // Collect tags
    const tags = this._collectTags($);

    // Extract datetime
    const datetime = this._extractDateTime($);

    return { links, datetime, tags, description: description.trim() };
  }

  _extractLinksFromSelection(
    $: cheerio.CheerioAPI,
    sel: cheerio.Cheerio,
  ): Link[] {
    const results: Link[] = [];
    const seen = new Set<string>();

    // From <a> href attributes
    sel.find("a[href]").each((_, node) => {
      const href = $(node).attr("href");
      if (!href) return;

      const { type, normalized } = this._classifyLink(href);
      if (!type || !normalized) return;
      if (seen.has(normalized)) return;

      const password = this._extractPasswordFromNode($, $(node));
      results.push({ type: type as CloudType, url: normalized, password });
      seen.add(normalized);
    });

    // From text content
    const text = sel.text();
    textURLRegex.lastIndex = 0;
    let match: RegExpExecArray | null = textURLRegex.exec(text);
    while (match !== null) {
      const raw = match[0];
      const { type, normalized } = this._classifyLink(raw);
      if (!type) continue;
      if (seen.has(normalized)) continue;

      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + match[0].length + 80);
      const context = text.substring(start, end);
      const password = this._matchPassword(context);

      results.push({ type: type as CloudType, url: normalized, password });
      seen.add(normalized);
      match = textURLRegex.exec(text);
    }

    return results;
  }

  _classifyLink(raw: string): { type: string; normalized: string } {
    raw = (raw || "").trim();
    if (!raw) return { type: "", normalized: "" };
    for (const pattern of linkPatterns) {
      const match = pattern.reg.exec(raw);
      if (match) {
        return { type: pattern.typ, normalized: match[0] };
      }
    }
    return { type: "", normalized: "" };
  }

  _extractPasswordFromNode(
    $: cheerio.CheerioAPI,
    node: cheerio.Cheerio,
  ): string {
    const candidates = [node.text()];

    const title = node.attr("title");
    if (title) candidates.push(title);

    const parent = node.parent();
    if (parent && parent.length > 0) {
      candidates.push(parent.text());
      const next = parent.next();
      if (next.length > 0) candidates.push(next.text());
    }

    const sibling = node.next();
    if (sibling.length > 0) candidates.push(sibling.text());

    for (const text of candidates) {
      const pwd = this._matchPassword(text);
      if (pwd) return pwd;
    }
    return "";
  }

  _matchPassword(text: string): string {
    text = (text || "").trim();
    if (!text) return "";
    for (const pattern of passwordPatterns) {
      const match = pattern.exec(text);
      if (match && match.length > 1) return match[1].trim();
    }
    return "";
  }

  _collectTags($: cheerio.CheerioAPI): string[] {
    const tagSet = new Set<string>();
    $(".breadcrumbs a").each((_, el) => {
      const text = $(el).text().trim();
      if (text && !text.includes("首页")) tagSet.add(text);
    });
    return Array.from(tagSet);
  }

  _extractDateTime($: cheerio.CheerioAPI): string {
    const selectors = [
      "meta[property='article:modified_time']",
      "meta[property='article:published_time']",
      "meta[name='article:modified_time']",
      "meta[name='article:published_time']",
    ];

    for (const sel of selectors) {
      const node = $(sel);
      if (node.length > 0) {
        const value = (node.attr("content") || "").trim();
        if (value) {
          try {
            const d = new Date(value);
            if (!isNaN(d.getTime())) return d.toISOString();
          } catch (e) {
            /* ignore */
          }
        }
      }
    }

    return "";
  }

  _mergeTags(primary: string, extra: string[]): string[] {
    const set = new Set<string>();
    if (primary && primary.trim()) set.add(primary.trim());
    (extra || []).forEach((t) => {
      if (t && t.trim()) set.add(t.trim());
    });
    return Array.from(set);
  }

  _buildUniqueID(detailURL: string): string {
    // CRC32 equivalent using md5 hash
    const hash = crypto
      .createHash("md5")
      .update(detailURL)
      .digest("hex")
      .slice(0, 8);
    const num = parseInt(hash, 16);
    return `${this.name}-${num}`;
  }

  _normalizeURL(raw: string): string {
    if (raw.startsWith("http")) return raw;
    return BASE_URL + raw.trim();
  }
}

export default MizixingPlugin;
