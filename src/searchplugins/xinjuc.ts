import * as cheerio from 'cheerio';
import {
  BasePlugin,
  cleanHTML,
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

const PLUGIN_NAME = "xinjuc";
const SITE_URL = "https://www.xinjuc.com";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  Referer: SITE_URL,
};

// Pre-compiled regex patterns
const BAIDU_LINK_REGEX =
  /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]{10,}(?:\?pwd=[0-9a-zA-Z]+)?/g;
const PWD_REGEX = /提取码[：:]\s*([a-zA-Z0-9]{4})/;
const PWD_URL_REGEX = /\?pwd=([0-9a-zA-Z]+)/;
const DETAIL_ID_REGEX = /\/(\d+)\.html/;

interface XinjucSearchResult extends SearchResult {
  content: string; // Detail URL stored in content
}

class XinjucPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 1. Build search URL
    const searchURL = `${SITE_URL}/?s=${encodeURIComponent(keyword)}`;

    // 2. Send request
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: HEADERS,
      },
      { timeout: 10000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Extract search results
    const results: XinjucSearchResult[] = [];
    const postList = $("div.row-xs.post-list article.post-item");
    if (postList.length === 0) return [];

    postList.each((i: number, el: cheerio.Element) => {
      const result = this.parseSearchItem($, $(el), keyword);
      if (result && result.uniqueId) {
        results.push(result);
      }
    });

    // 4. Enhance with detail page info
    const enhancedResults = await this.enhanceWithDetails(results);

    // 5. Keyword filter
    return filterByKeyword(enhancedResults, keyword);
  }

  parseSearchItem(
    $: cheerio.CheerioAPI,
    s: cheerio.Cheerio<cheerio.Element>,
    keyword: string,
  ): XinjucSearchResult | null {
    // Extract detail page link
    const linkElem = s.find("div.post-image a");
    if (linkElem.length === 0) return null;

    let detailLink = linkElem.attr("href") || "";
    if (!detailLink) return null;

    // Handle relative path
    if (!detailLink.startsWith("http")) {
      if (detailLink.startsWith("/")) {
        detailLink = SITE_URL + detailLink;
      } else {
        detailLink = SITE_URL + "/" + detailLink;
      }
    }

    // Extract ID
    const idMatch = detailLink.match(DETAIL_ID_REGEX);
    if (!idMatch) return null;
    const itemID = idMatch[1];

    // Extract title
    const titleElem = s.find("h5.post-title a");
    const title = titleElem.length > 0 ? titleElem.text().trim() : "";

    // Extract mark (e.g., "更至163", "1080P")
    const tags: string[] = [];
    const markElem = s.find("div.mark span");
    if (markElem.length > 0) {
      const mark = markElem.text().trim();
      if (mark) tags.push(mark);
    }

    // Extract update time
    let datetime = new Date().toISOString();
    const timeElem = s.find("div.post-footer span.time");
    if (timeElem.length > 0) {
      const timeStr = timeElem.text().trim();
      datetime = this.parseTime(timeStr);
    }

    return {
      uniqueId: `${PLUGIN_NAME}-${itemID}`,
      title,
      content: detailLink, // Store detail URL in content for later use
      links: [],
      datetime,
      tags,
      channel: "",
    };
  }

  parseTime(timeStr: string): string {
    // Format examples: "2025-04-21 更新", "04-21"
    timeStr = timeStr.replace(" 更新", "").trim();

    // Try full date format
    const fullDate = new Date(timeStr);
    if (!isNaN(fullDate.getTime()) && timeStr.length >= 8) {
      return fullDate.toISOString();
    }

    // Try month-day format (e.g., "04-21")
    const mdMatch = timeStr.match(/^(\d{1,2})-(\d{1,2})$/);
    if (mdMatch) {
      const now = new Date();
      const date = new Date(
        now.getFullYear(),
        parseInt(mdMatch[1]) - 1,
        parseInt(mdMatch[2]),
      );
      return date.toISOString();
    }

    return new Date().toISOString();
  }

  async enhanceWithDetails(
    results: XinjucSearchResult[],
  ): Promise<SearchResult[]> {
    const enhancedResults: SearchResult[] = [];

    const tasks = results.map(async (result) => {
      try {
        const detailURL = result.content; // Detail URL was stored in content
        const { links, content } = await this.getDetailInfo(detailURL);

        const enhanced: SearchResult = { ...result };
        enhanced.links = links;
        enhanced.content = content;

        // Only include results that have links
        if (links.length > 0) {
          return enhanced;
        }
      } catch (e) {
        // skip
      }
      return null;
    });

    const settled = await Promise.all(tasks);
    return settled.filter((item): item is SearchResult => item !== null);
  }

  async getDetailInfo(
    detailURL: string,
  ): Promise<{ links: Link[]; content: string }> {
    try {
      const resp = await fetchWithTimeout(
        detailURL,
        {
          headers: HEADERS,
        },
        8000,
      );

      if (!resp.ok) return { links: [], content: "" };

      const html = await resp.text();
      const $ = cheerio.load(html);

      // Find article content area
      const articleContent = $("div.article-content");
      if (articleContent.length === 0) return { links: [], content: "" };

      // Extract Baidu links from the entire document
      const links = this.extractLinksFromDoc($, html);

      // Extract description from article content
      const content = this.extractContent(articleContent);

      return { links, content };
    } catch (e) {
      return { links: [], content: "" };
    }
  }

  extractLinksFromDoc($: cheerio.CheerioAPI, htmlContent: string): Link[] {
    const links: Link[] = [];
    const linkMap = new Set<string>();

    // Extract password from text
    let password = "";
    const pwdMatch = htmlContent.match(PWD_REGEX);
    if (pwdMatch) password = pwdMatch[1];

    // Method 1: Regex extract all Baidu links from HTML
    const baiduLinks = htmlContent.match(BAIDU_LINK_REGEX) || [];
    for (let baiduURL of baiduLinks) {
      baiduURL = baiduURL.trim();
      if (!this.isValidBaiduLink(baiduURL)) continue;
      if (linkMap.has(baiduURL)) continue;
      linkMap.add(baiduURL);

      // Extract password from URL if present
      let urlPassword = password;
      const urlPwdMatch = baiduURL.match(PWD_URL_REGEX);
      if (urlPwdMatch) urlPassword = urlPwdMatch[1];

      links.push({ type: "baidu", url: baiduURL, password: urlPassword });
    }

    // Method 2: Extract from <a> tags as supplement
    $("a").each((i: number, el: cheerio.Element) => {
      const href = ($(el).attr("href") || "").trim();
      if (!href) return;

      if (
        !href.startsWith("http://pan.baidu.com") &&
        !href.startsWith("https://pan.baidu.com")
      )
        return;
      if (!this.isValidBaiduLink(href)) return;
      if (linkMap.has(href)) return;
      linkMap.add(href);

      let urlPassword = password;
      const urlPwdMatch = href.match(PWD_URL_REGEX);
      if (urlPwdMatch) urlPassword = urlPwdMatch[1];

      links.push({ type: "baidu", url: href, password: urlPassword });
    });

    return links;
  }

  isValidBaiduLink(link: string): boolean {
    if (
      !link.startsWith("http://pan.baidu.com") &&
      !link.startsWith("https://pan.baidu.com")
    )
      return false;
    if (!link.includes("/s/")) return false;
    return /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]{10,}/.test(link);
  }

  extractContent(articleContent: cheerio.Cheerio<cheerio.Element>): string {
    let content = articleContent.text().trim();

    // Clean whitespace
    content = content.replace(/\s+/g, " ");

    // Remove Baidu-related text
    content = content.replace(/百度云网盘资源下载地址[：:]?\s*/g, "");
    content = content.replace(
      /链接[：:]?\s*https?:\/\/pan\.baidu\.com\/[^\s]+/g,
      "",
    );
    content = content.replace(/提取码[：:]?\s*[a-zA-Z0-9]{4}/g, "");
    content = content.trim();

    // Limit length
    if (content.length > 300) {
      content = content.substring(0, 300) + "...";
    }

    return content;
  }
}

export default XinjucPlugin;
