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

// Pre-compiled regex patterns
const detailIDRegex = /\/vod\/detail\/id\/(\d+)\.html/;
const quarkLinkRegex = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/;

const BASE_URL = "http://xiaocge.fun";

class LabiPlugin extends BasePlugin {
  constructor() {
    super("labi", 1);
  }

  /**
   * Search for resources
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 1. Build search URL
    const searchURL = `${BASE_URL}/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;

    // 2. Send search request
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
          Referer: `${BASE_URL}/`,
        },
      },
      { timeout: 8000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Extract search results
    const results: Array<SearchResult & { _itemID?: string }> = [];
    $(".module-search-item").each((i: number, el: any) => {
      const s = $(el);
      const parsed = this._parseSearchItem($, s);
      if (parsed && parsed.uniqueId) {
        results.push(parsed);
      }
    });

    // 4. Fetch detail pages for download links (concurrently)
    const enhanced = await this._enhanceWithDetails(results);

    // 5. Filter by keyword
    return filterByKeyword(enhanced, keyword);
  }

  /**
   * Parse a single search result item
   */
  _parseSearchItem(
    $: any,
    s: any,
  ): (SearchResult & { _itemID?: string }) | null {
    // Extract detail link
    const detailLinkEl = s.find(".module-item-pic a").first();
    const detailLink = detailLinkEl.attr("href");
    if (!detailLink) return null;

    // Extract ID
    const matches = detailIDRegex.exec(detailLink);
    if (!matches || matches.length < 2) return null;

    const itemID = matches[1];
    const uniqueId = `${this.name}-${itemID}`;

    // Extract title
    const title = s.find(".video-info-header h3 a").text().trim();

    // Extract quality
    const quality = s.find(".video-serial").text().trim();

    // Extract tags
    const tags: string[] = [];
    s.find(".video-info-aux .tag-link a").each(
      (i: number, tag: any) => {
        const tagText = $(tag).text().trim();
        if (tagText) tags.push(tagText);
      },
    );

    // Extract director
    let director = "";
    s.find(".video-info-items").each((i: number, item: any) => {
      const titleText = $(item).find(".video-info-itemtitle").text().trim();
      if (titleText.includes("导演")) {
        director = $(item).find(".video-info-actor a").text().trim();
      }
    });

    // Extract actors
    const actors: string[] = [];
    s.find(".video-info-items").each((i: number, item: any) => {
      const titleText = $(item).find(".video-info-itemtitle").text().trim();
      if (titleText.includes("主演")) {
        $(item)
          .find(".video-info-actor a")
          .each((j: number, actor: any) => {
            const actorName = $(actor).text().trim();
            if (actorName) actors.push(actorName);
          });
      }
    });

    // Extract plot
    let plot = "";
    s.find(".video-info-items").each((i: number, item: any) => {
      const titleText = $(item).find(".video-info-itemtitle").text().trim();
      if (titleText.includes("剧情")) {
        plot = $(item).find(".video-info-item").text().trim();
      }
    });

    // Build content description
    const contentParts: string[] = [];
    if (quality) contentParts.push(`【${quality}】`);
    if (director) contentParts.push(`导演：${director}`);
    if (actors.length > 0) {
      let actorStr = actors.slice(0, 3).join("、");
      if (actors.length > 3) actorStr += "等";
      contentParts.push(`主演：${actorStr}`);
    }
    if (plot) contentParts.push(plot);

    return {
      uniqueId,
      title,
      content: contentParts.join("\n"),
      links: [],
      datetime: "",
      tags,
      channel: "",
      _itemID: itemID, // internal: used for detail fetch
    };
  }

  /**
   * Fetch detail pages concurrently to get download links
   */
  async _enhanceWithDetails(
    results: Array<SearchResult & { _itemID?: string }>,
  ): Promise<SearchResult[]> {
    const tasks = results.map(async (r) => {
      try {
        const links = await this._fetchDetailLinks(r._itemID!);
        r.links = links;
      } catch (e) {
        // ignore detail fetch errors
      }
      delete r._itemID;
      return r;
    });

    return Promise.all(tasks);
  }

  /**
   * Fetch detail page and extract quark download links
   */
  async _fetchDetailLinks(itemID: string): Promise<Link[]> {
    const detailURL = `${BASE_URL}/index.php/vod/detail/id/${itemID}.html`;

    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: `${BASE_URL}/`,
        },
      },
      { timeout: 6000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const links: Link[] = [];
    const seen = new Set<string>();

    $("#download-list .module-row-one").each(
      (i: number, el: any) => {
        const s = $(el);

        // Extract from data-clipboard-text attribute
        const clipboardText = s
          .find("[data-clipboard-text]")
          .attr("data-clipboard-text");
        if (
          clipboardText &&
          this._isValidURL(clipboardText) &&
          quarkLinkRegex.test(clipboardText)
        ) {
          if (!seen.has(clipboardText)) {
            seen.add(clipboardText);
            links.push({ type: "quark", url: clipboardText, password: "" });
          }
        }

        // Also check direct href attributes
        s.find("a[href]").each((j: number, a: any) => {
          const href = $(a).attr("href");
          if (href && this._isValidURL(href) && quarkLinkRegex.test(href)) {
            if (!seen.has(href)) {
              seen.add(href);
              links.push({ type: "quark", url: href, password: "" });
            }
          }
        });
      },
    );

    return links;
  }

  /**
   * Check if URL is a valid network drive URL
   */
  _isValidURL(url: string): boolean {
    if (
      !url ||
      url.includes("javascript:") ||
      url.includes("#") ||
      !url.startsWith("http")
    ) {
      return false;
    }
    return quarkLinkRegex.test(url);
  }
}

export default LabiPlugin;
