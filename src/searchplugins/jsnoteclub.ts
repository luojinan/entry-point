import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
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
import type { Link, SearchResult } from "./types";

const PLUGIN_NAME = "jsnoteclub";
const DATA_KEY_REGEX = /data-key="([0-9a-fA-F]+)"/;
const MAX_MATCHED_POSTS = 30;

interface LinkPattern {
  reg: RegExp;
  type: string;
}

const LINK_PATTERNS: LinkPattern[] = [
  { reg: /https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z]+/, type: "quark" },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_]+/, type: "xunlei" },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_]+/, type: "baidu" },
  {
    reg: /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/,
    type: "aliyun",
  },
  { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, type: "uc" },
  {
    reg: /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/,
    type: "123",
  },
  {
    reg: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/,
    type: "pikpak",
  },
  { reg: /https?:\/\/caiyun\.139\.com\/[^\s<>"']+/, type: "mobile" },
  { reg: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, type: "magnet" },
  { reg: /ed2k:\/\/[^\s<>"']+/, type: "ed2k" },
];

const PASSWORD_PATTERNS = [
  /\u63D0\u53D6\u7801[:：]?\s*([0-9A-Za-z]+)/,
  /\u5BC6\u7801[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/g;

interface Post {
  id: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  url: string;
  updated_at?: string;
  visibility?: string;
}

interface ClassifiedLink {
  type: string;
  normalized: string;
}

class JsNoteClubPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    let searchKeyword = keyword.trim();
    if (!searchKeyword) {
      throw new Error(`[${PLUGIN_NAME}] keyword cannot be empty`);
    }

    if (ext && typeof ext.title_en === "string") {
      const titleEn = ext.title_en.trim();
      if (titleEn) {
        searchKeyword = `${searchKeyword} ${titleEn}`;
      }
    }

    // Step 1: Get all posts
    const allPosts = await this.getAllPosts();

    // Step 2: Filter by keyword
    let matched = this.filterPostsByKeyword(allPosts, searchKeyword);
    if (matched.length === 0) {
      return [];
    }
    if (matched.length > MAX_MATCHED_POSTS) {
      matched = matched.slice(0, MAX_MATCHED_POSTS);
    }

    // Step 3: Concurrently fetch detail links
    const tasks = matched.map(async (post) => {
      try {
        const links = await this.fetchDetailLinks(post.url);
        if (links.length === 0) return null;

        return {
          uniqueId: `${PLUGIN_NAME}-${post.id}`,
          title: (post.title || "").trim(),
          content: (post.excerpt || "").trim(),
          links,
          tags: post.slug ? [post.slug.trim()] : [],
          channel: "",
          datetime: this.parseUpdatedAt(post.updated_at),
        };
      } catch (e) {
        return null;
      }
    });

    const settled = await Promise.all(tasks);
    const results = settled.filter((r): r is SearchResult => r !== null);

    return filterByKeyword(results, searchKeyword);
  }

  private async getAllPosts(): Promise<Post[]> {
    // Step 1: Fetch data key from homepage
    const dataKey = await this.fetchDataKey();

    // Step 2: Fetch posts using the data key
    return this.fetchPosts(dataKey);
  }

  private async fetchDataKey(): Promise<string> {
    const resp = await fetchWithRetry(
      "https://jsnoteclub.com/",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: "https://jsnoteclub.com/",
        },
      },
      { timeout: 12000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract all script tags
    let scriptsHTML = "";
    $("script").each((i, el) => {
      scriptsHTML += $.html(el);
    });

    const match = DATA_KEY_REGEX.exec(scriptsHTML);
    if (!match || match.length < 2) {
      throw new Error(`[${PLUGIN_NAME}] data-key not found on homepage`);
    }

    return match[1];
  }

  private async fetchPosts(dataKey: string): Promise<Post[]> {
    const params = new URLSearchParams();
    params.set("key", dataKey);
    params.set("limit", "10000");
    params.set("fields", "id,slug,title,excerpt,url,updated_at,visibility");
    params.set("order", "updated_at DESC");

    const reqURL = `https://jsnoteclub.com/ghost/api/content/posts/?${params.toString()}`;

    const resp = await fetchWithRetry(
      reqURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: "https://jsnoteclub.com/",
        },
      },
      { timeout: 12000, retries: 2 },
    );

    const data = await resp.json();
    return data.posts || [];
  }

  private async fetchDetailLinks(detailURL: string): Promise<Link[]> {
    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Connection: "keep-alive",
            Referer: detailURL,
          },
        },
        { timeout: 10000, retries: 2 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      // Find content area
      let content = $("section.gh-content");
      if (content.length === 0) content = $(".gh-content");
      if (content.length === 0) content = $("article");
      if (content.length === 0) content = $.root();

      // Remove sidebars
      content.find("aside").remove();
      content.find(".gh-sidebar").remove();
      content.find(".sidebar-left").remove();
      content.find(".left-ads").remove();

      return this.extractLinksFromSelection($, content);
    } catch (e) {
      return [];
    }
  }

  private extractLinksFromSelection($: CheerioAPI, sel: any): Link[] {
    const results: Link[] = [];
    const seen = new Set<string>();

    // Extract links from <a href>
    sel.find("a[href]").each((i: number, el: any) => {
      const href = ($(el).attr("href") || "").trim();
      if (!href) return;

      const classified = this.classifyLink(href);
      if (!classified) return;

      if (seen.has(classified.normalized)) return;

      const password = this.extractPasswordFromNode($, $(el));

      results.push({
        type: classified.type as any,
        url: classified.normalized,
        password,
      });
      seen.add(classified.normalized);
    });

    // Extract URLs from text content
    const text = sel.text();
    let match: RegExpExecArray | null;
    const urlRegex = /https?:\/\/[^\s<>"']+/g;
    match = urlRegex.exec(text);
    while (match !== null) {
      const raw = match[0];
      const classified = this.classifyLink(raw);
      if (classified && !seen.has(classified.normalized)) {
        // Get surrounding context for password extraction
        const start = Math.max(0, match.index - 80);
        const end = Math.min(text.length, match.index + match[0].length + 80);
        const context = text.substring(start, end);
        const password = this.matchPassword(context);

        results.push({
          type: classified.type as any,
          url: classified.normalized,
          password,
        });
        seen.add(classified.normalized);
      }
      match = urlRegex.exec(text);
    }

    return results;
  }

  private classifyLink(raw: string): ClassifiedLink | null {
    for (const pattern of LINK_PATTERNS) {
      const loc = raw.match(pattern.reg);
      if (loc) {
        return { type: pattern.type, normalized: loc[0] };
      }
    }
    return null;
  }

  private extractPasswordFromNode($: CheerioAPI, node: any): string {
    const candidates: string[] = [node.text()];

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

    for (const c of candidates) {
      const pwd = this.matchPassword(c);
      if (pwd) return pwd;
    }
    return "";
  }

  private matchPassword(text: string): string {
    if (!text || !text.trim()) return "";
    for (const pattern of PASSWORD_PATTERNS) {
      const matches = pattern.exec(text);
      if (matches && matches.length > 1) {
        return matches[1].trim();
      }
    }
    return "";
  }

  private filterPostsByKeyword(posts: Post[], keyword: string): Post[] {
    if (!keyword) return posts;
    const parts = keyword.toLowerCase().split(/\s+/).filter(Boolean);

    return posts.filter((post) => {
      const target =
        `${post.title || ""} ${post.excerpt || ""} ${post.slug || ""}`.toLowerCase();
      return parts.every((part) => target.includes(part));
    });
  }

  private parseUpdatedAt(updatedAt: string | undefined): string {
    if (!updatedAt) return new Date().toISOString();

    // Try parsing with built-in Date
    const parsed = new Date(updatedAt);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return new Date().toISOString();
  }
}

export default JsNoteClubPlugin;
