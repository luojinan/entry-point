import * as cheerio from 'cheerio';
import { BasePlugin, fetchWithRetry } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "qingying";
const BASE_URL = "http://revohd.com";
const SEARCH_PATH = "/vodsearch/-------------.html";
const MAX_RESULTS = 10;
const MAX_CONCURRENT = 3;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  Referer: BASE_URL,
};

const PAN_123_DOMAINS = [
  "123684.com",
  "123685.com",
  "123912.com",
  "123pan.com",
  "123pan.cn",
  "123592.com",
];

interface SearchItem {
  id: string;
  title: string;
  detailURL: string;
}

class QingYingPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?wd=${encodeURIComponent(keyword)}`;

    // Step 1: Fetch search results
    const items = await this.fetchSearchResults(searchURL);
    if (items.length === 0) return [];

    // Step 2: Filter by keyword
    const filteredItems = this.filterItemsByKeyword(items, keyword);
    if (filteredItems.length === 0) return [];

    // Step 3: Limit results
    const limitedItems = filteredItems.slice(0, MAX_RESULTS);

    // Step 4: Process detail pages concurrently (max 3)
    return this.processDetailPages(limitedItems);
  }

  private async fetchSearchResults(searchURL: string): Promise<SearchItem[]> {
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: HEADERS,
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const items: SearchItem[] = [];
    const idRegex = /\/voddetail\/(\d+)\.html/;

    $("div.module-search-item").each((i, el) => {
      const s = $(el);
      const link = s.find(".video-info .video-info-header h3 a");
      const href = link.attr("href");
      if (!href) return;

      let title = link.text().trim();
      if (!title) {
        title = (link.attr("title") || "").trim();
      }
      if (!title) return;

      const matches = href.match(idRegex);
      if (!matches || matches.length < 2) return;

      items.push({
        id: matches[1],
        title,
        detailURL: this.buildAbsURL(href),
      });
    });

    return items;
  }

  private filterItemsByKeyword(
    items: SearchItem[],
    keyword: string,
  ): SearchItem[] {
    const lowerKeyword = keyword.toLowerCase();
    return items.filter((item) =>
      item.title.toLowerCase().includes(lowerKeyword),
    );
  }

  private async processDetailPages(
    items: SearchItem[],
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    // Process in batches of MAX_CONCURRENT to limit concurrency
    for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
      const batch = items.slice(i, i + MAX_CONCURRENT);
      const promises = batch.map((item) =>
        this.processDetailPage(item).catch(() => null),
      );
      const settled = await Promise.allSettled(promises);
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          results.push(result.value);
        }
      }
    }
    return results;
  }

  private async processDetailPage(
    item: SearchItem,
  ): Promise<SearchResult | null> {
    const resp = await fetchWithRetry(
      item.detailURL,
      {
        headers: HEADERS,
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract title
    let title = $(".video-info .video-info-header h1.page-title a")
      .text()
      .trim();
    if (!title) title = item.title;

    // Extract description and update time from .video-info-items
    let description = "";
    let updateTime = "";

    $(".video-info-items").each((i, el) => {
      const s = $(el);
      const itemTitle = s.find(".video-info-itemtitle").text().trim();

      if (itemTitle.includes("更新")) {
        const timeText = s.find(".video-info-item").text().trim();
        updateTime = this.parseUpdateTimeFromHTML(timeText);
      }

      if (itemTitle.includes("剧情")) {
        const contentSpan = s.find(".video-info-item.video-info-content span");
        if (contentSpan.length > 0) {
          description = contentSpan.text().trim();
        } else {
          description = s.find(".video-info-item").text().trim();
        }
      }
    });

    if (!updateTime) {
      updateTime = new Date().toISOString();
    }

    // Extract 123pan link
    const panLink = this.extract123PanLink($);
    if (!panLink) return null;

    return {
      uniqueId: `${PLUGIN_NAME}-${item.id}`,
      title,
      content: description,
      links: [panLink],
      channel: "",
      datetime: updateTime,
      tags: [],
    };
  }

  private extract123PanLink($: cheerio.CheerioAPI): Link | null {
    // Check if there is a heading containing "123" and "云盘"
    let found = false;
    $(".module-heading h2.module-title").each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes("123") && text.includes("云盘")) {
        found = true;
      }
    });

    if (!found) return null;

    // Find the 123pan URL from download list
    let panURL = "";
    $(".module-downlist .module-row-text").each((i, el) => {
      if (panURL) return;

      const clipboardText = $(el).attr("data-clipboard-text");
      if (!clipboardText) return;

      const url = clipboardText.trim();
      for (const domain of PAN_123_DOMAINS) {
        if (url.includes(domain)) {
          panURL = url;
          return;
        }
      }
    });

    if (!panURL) return null;

    const password = this.extractPassword(panURL);

    return {
      type: "123" as CloudType,
      url: panURL,
      password,
    };
  }

  private parseUpdateTimeFromHTML(timeText: string): string {
    const re = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
    const matches = timeText.match(re);
    if (!matches || matches.length < 2) return "";

    const timeStr = matches[1].trim();
    const parsed = new Date(timeStr.replace(" ", "T"));
    if (isNaN(parsed.getTime())) return "";

    return parsed.toISOString();
  }

  private extractPassword(panURL: string): string {
    // Try URL parsing first
    try {
      const urlObj = new URL(panURL);
      const pwd = urlObj.searchParams.get("pwd");
      if (pwd && pwd.length === 4) return pwd;
    } catch (e) {
      // URL parse failed, fall through to regex
    }

    // Fallback to regex
    const pwdMatch = panURL.match(/pwd=([a-zA-Z0-9]{4})/);
    if (pwdMatch) return pwdMatch[1];

    return "";
  }

  private buildAbsURL(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    if (path.startsWith("//")) {
      return "https:" + path;
    }
    if (!path.startsWith("/")) {
      path = "/" + path;
    }
    return BASE_URL + path;
  }
}

export default QingYingPlugin;
