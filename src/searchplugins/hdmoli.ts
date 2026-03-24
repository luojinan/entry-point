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

const PLUGIN_NAME = "hdmoli";
const BASE_URL = "https://www.hdmoli.pro";
const SEARCH_PATH = "/search.php?searchkey=%s&submit=";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const MAX_RESULTS = 50;

interface SearchResultWithDetail extends SearchResult {
  _detailURL: string;
}

class HdmoliPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Step 1: Execute search to get result list
    const searchResults = await this.executeSearch(keyword);

    // Step 2: Fetch detail page links concurrently
    const finalResults = await this.fetchDetailLinks(searchResults);

    // Step 3: Filter by keyword
    return filterByKeyword(finalResults, keyword);
  }

  private async executeSearch(
    keyword: string,
  ): Promise<SearchResultWithDetail[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH.replace("%s", encodeURIComponent(keyword))}`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
          Referer: BASE_URL + "/",
        },
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.parseSearchResults($);
  }

  private parseSearchResults($: CheerioAPI): SearchResultWithDetail[] {
    const results: SearchResultWithDetail[] = [];

    $("#searchList > li.active.clearfix").each((i, el) => {
      if (results.length >= MAX_RESULTS) return;

      const result = this.parseResultItem($, $(el), i + 1);
      if (result) {
        results.push(result);
      }
    });

    return results;
  }

  private parseResultItem(
    $: CheerioAPI,
    s: any,
    index: number,
  ): SearchResultWithDetail | null {
    const titleEl = s.find(".detail h4.title a");
    if (titleEl.length === 0) return null;

    const title = titleEl.text().trim();
    if (!title) return null;

    let detailURL = titleEl.attr("href") || "";
    if (!detailURL) {
      const thumbEl = s.find(".thumb a");
      if (thumbEl.length > 0) {
        detailURL = thumbEl.attr("href") || "";
      }
    }
    if (!detailURL) return null;

    if (detailURL.startsWith("/")) {
      detailURL = BASE_URL + detailURL;
    }

    // Extract rating
    const rating = s.find(".pic-tag").text().trim();

    // Extract update status
    const updateStatus = s.find(".pic-text").text().trim();

    // Extract director
    let director = "";
    s.find("p").each((i: number, el: any) => {
      if (director) return;
      const text = $(el).text();
      if (text.includes("\u5BFC\u6F14\uFF1A")) {
        const parts = text.split("\u5BFC\u6F14\uFF1A");
        if (parts.length > 1) {
          director = parts[1].trim();
        }
      }
    });

    // Extract actors
    const actors: string[] = [];
    s.find("p").each((i: number, el: any) => {
      const text = $(el).text();
      if (text.includes("\u4E3B\u6F14\uFF1A")) {
        $(el)
          .find("a")
          .each((j: number, a: any) => {
            const actor = $(a).text().trim();
            if (actor) actors.push(actor);
          });
      }
    });

    // Extract category info
    const { category, region, year } = this.extractCategoryInfo($, s);

    // Extract description
    let description = "";
    s.find("p.hidden-xs").each((i: number, el: any) => {
      if (description) return;
      const text = $(el).text();
      if (text.includes("\u7B80\u4ECB\uFF1A")) {
        const parts = text.split("\u7B80\u4ECB\uFF1A");
        if (parts.length > 1) {
          let desc = parts[1].trim();
          if (desc.length > 200) {
            desc = desc.substring(0, 200) + "...";
          }
          description = desc;
        }
      }
    });

    // Build content
    const contentParts: string[] = [];
    if (rating) contentParts.push(`\u8BC4\u5206\uFF1A${rating}`);
    if (updateStatus) contentParts.push(`\u72B6\u6001\uFF1A${updateStatus}`);
    if (director) contentParts.push(`\u5BFC\u6F14\uFF1A${director}`);
    if (actors.length > 0) {
      let actorStr = actors.join(" ");
      if (actorStr.length > 100) actorStr = actorStr.substring(0, 100) + "...";
      contentParts.push(`\u4E3B\u6F14\uFF1A${actorStr}`);
    }
    if (category) contentParts.push(`\u5206\u7C7B\uFF1A${category}`);
    if (region) contentParts.push(`\u5730\u533A\uFF1A${region}`);
    if (year) contentParts.push(`\u5E74\u4EFD\uFF1A${year}`);
    if (description) contentParts.push(`\u7B80\u4ECB\uFF1A${description}`);

    const content = contentParts.join("\n");

    const tags: string[] = [];
    if (category) tags.push(category);
    if (region) tags.push(region);
    if (year) tags.push(year);

    return {
      uniqueId: generateUniqueID(
        PLUGIN_NAME,
        String(index),
        String(Date.now()),
      ),
      title,
      content,
      links: [],
      datetime: new Date().toISOString(),
      tags,
      channel: "",
      _detailURL: detailURL,
    };
  }

  private extractCategoryInfo(
    $: CheerioAPI,
    s: any,
  ): { category: string; region: string; year: string } {
    let category = "",
      region = "",
      year = "";

    s.find("p").each((i: number, el: any) => {
      const text = $(el).text();
      if (text.includes("\u5206\u7C7B\uFF1A")) {
        const parts = text.split("\uFF1A");
        for (let idx = 0; idx < parts.length; idx++) {
          const part = parts[idx].trim();
          if (part.endsWith("\u5206\u7C7B") && idx + 1 < parts.length) {
            const info = parts[idx + 1].trim();
            const infoParts = info.split(/[,\uff0c\s]+/);
            if (infoParts.length > 0 && infoParts[0]) category = infoParts[0];
          } else if (part.endsWith("\u5730\u533A") && idx + 1 < parts.length) {
            const regionPart = parts[idx + 1].trim();
            const regionParts = regionPart.split(/[,\uff0c\s]+/);
            if (regionParts.length > 0 && regionParts[0])
              region = regionParts[0];
          } else if (part.endsWith("\u5E74\u4EFD") && idx + 1 < parts.length) {
            const yearPart = parts[idx + 1].trim();
            const yearParts = yearPart.split(/[,\uff0c\s]+/);
            if (yearParts.length > 0 && yearParts[0]) year = yearParts[0];
          }
        }
      }
    });

    return { category, region, year };
  }

  private async fetchDetailLinks(
    searchResults: SearchResultWithDetail[],
  ): Promise<SearchResult[]> {
    if (searchResults.length === 0) return [];

    const tasks = searchResults.map(async (result) => {
      const detailURL = result._detailURL;
      if (!detailURL) return null;

      try {
        const links = await this.fetchDetailPageLinks(detailURL);
        if (links.length > 0) {
          const { _detailURL, ...cleanResult } = result;
          cleanResult.links = links;
          return cleanResult;
        }
      } catch (e) {
        // skip failed detail pages
      }
      return null;
    });

    const settled = await Promise.all(tasks);
    return settled.filter((r): r is SearchResult => r !== null);
  }

  private async fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Referer: BASE_URL + "/",
          },
        },
        { timeout: 30000, retries: 1 },
      );

      const html = await resp.text();
      return this.parseNetworkDiskLinks(html);
    } catch (e) {
      return [];
    }
  }

  private parseNetworkDiskLinks(htmlContent: string): Link[] {
    const links: Link[] = [];
    const $ = cheerio.load(htmlContent);

    $(".downlist").each((i, el) => {
      $(el)
        .find("p")
        .each((j, pEl) => {
          const text = $(pEl).text();

          // Quark links
          if (
            text.includes("\u5938 \u514B\uFF1A") ||
            text.includes("\u5938\u514B\uFF1A")
          ) {
            $(pEl)
              .find("a")
              .each((k, a) => {
                const href = $(a).attr("href") || "";
                if (href.includes("pan.quark.cn")) {
                  links.push({ type: "quark", url: href, password: "" });
                }
              });
          }

          // Baidu links
          if (
            text.includes("\u767E \u5EA6\uFF1A") ||
            text.includes("\u767E\u5EA6\uFF1A")
          ) {
            $(pEl)
              .find("a")
              .each((k, a) => {
                const href = $(a).attr("href") || "";
                if (href.includes("pan.baidu.com")) {
                  const password = this.extractPasswordFromBaiduURL(href);
                  links.push({ type: "baidu", url: href, password });
                }
              });
          }
        });
    });

    // Fallback: regex-based extraction
    if (links.length === 0) {
      return this.parseNetworkDiskLinksWithRegex(htmlContent);
    }

    return links;
  }

  private parseNetworkDiskLinksWithRegex(htmlContent: string): Link[] {
    const links: Link[] = [];

    // Quark pattern
    const quarkPattern =
      /<b>\u5938\s*\u514B\uFF1A<\/b><a[^>]*href\s*=\s*["']([^"']*pan\.quark\.cn[^"']*)["'][^>]*>/g;
    let match: RegExpExecArray | null = quarkPattern.exec(htmlContent);
    while (match !== null) {
      links.push({ type: "quark", url: match[1], password: "" });
      match = quarkPattern.exec(htmlContent);
    }

    // Baidu pattern
    const baiduPattern =
      /<b>\u767E\s*\u5EA6\uFF1A<\/b><a[^>]*href\s*=\s*["']([^"']*pan\.baidu\.com[^"']*)["'][^>]*>/g;
    let baiduMatch: RegExpExecArray | null = baiduPattern.exec(htmlContent);
    while (baiduMatch !== null) {
      const password = this.extractPasswordFromBaiduURL(baiduMatch[1]);
      links.push({ type: "baidu", url: baiduMatch[1], password });
      baiduMatch = baiduPattern.exec(htmlContent);
    }

    return links;
  }

  private extractPasswordFromBaiduURL(panURL: string): string {
    if (panURL.includes("?pwd=")) {
      const parts = panURL.split("?pwd=");
      if (parts.length > 1) return parts[1];
    }
    if (panURL.includes("&pwd=")) {
      const parts = panURL.split("&pwd=");
      if (parts.length > 1) return parts[1];
    }
    return "";
  }
}

export default HdmoliPlugin;
