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

const BASE_URL = "https://leijing.xyz";
const SEARCH_PATH = "/search";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// Tianyi cloud link regex
const tianyiRegex = /https:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+/g;

class LeijingPlugin extends BasePlugin {
  constructor() {
    super("leijing", 2);
  }

  /**
   * Search for resources
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?keyword=${encodeURIComponent(keyword)}`;

    const headers = {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: BASE_URL,
    };

    const resp = await fetchWithRetry(
      searchURL,
      { headers },
      { timeout: 10000, retries: 2 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract search results
    const results: Array<SearchResult & { _detailURL?: string | null }> = [];
    const topicIdRegex = /topicId=(\d+)/;

    $(".topicItem").each((i: number, el: any) => {
      const s = $(el);

      // Extract title and detail link
      const titleElem = s.find(".title a");
      const title = titleElem.text().trim();
      const detailPath = titleElem.attr("href");

      if (!title || !detailPath) return;

      const detailURL = `${BASE_URL}/${detailPath.replace(/^\//, "")}`;

      // Extract summary
      const summary = s.find(".summary").text().trim();

      // Extract post time
      let postTime = s.find(".postTime").text().trim();
      postTime = postTime.replace(/^发表时间：/, "");

      // Extract ID from detail path
      const idMatch = topicIdRegex.exec(detailPath);
      const resourceID = idMatch ? idMatch[1] : `${Date.now()}`;

      // Try to extract tianyi links from summary
      const links = this._extractTianyiLinks(summary);

      const result: SearchResult & { _detailURL?: string | null } = {
        uniqueId: `${this.name}-${resourceID}`,
        title,
        content: summary,
        links,
        datetime: postTime || "",
        tags: [],
        channel: "",
        _detailURL: links.length === 0 ? detailURL : null, // internal: for detail fetch
      };

      results.push(result);
    });

    // Fetch detail page links for results that have no links
    await this._enrichWithDetailLinks(results, headers);

    // Filter out results without links
    const filtered = results.filter((r) => r.links.length > 0);

    // Clean up internal fields
    filtered.forEach((r) => {
      delete r._detailURL;
    });

    return filtered;
  }

  /**
   * Extract tianyi cloud links from text
   */
  _extractTianyiLinks(text: string): Link[] {
    const links: Link[] = [];
    const seen = new Set<string>();

    // Reset regex lastIndex for global regex
    tianyiRegex.lastIndex = 0;
    let match: RegExpExecArray | null = tianyiRegex.exec(text);
    while (match !== null) {
      const url = match[0];
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ type: "tianyi", url, password: "" });
      }
      match = tianyiRegex.exec(text);
    }

    return links;
  }

  /**
   * Fetch detail pages concurrently to get download links
   */
  async _enrichWithDetailLinks(
    results: Array<SearchResult & { _detailURL?: string | null }>,
    headers: Record<string, string>,
  ): Promise<void> {
    const tasks = results.map(async (r, idx) => {
      if (r.links.length > 0 || !r._detailURL) return;

      try {
        // Small delay to avoid too many requests
        await new Promise((resolve) => setTimeout(resolve, idx * 50));

        const links = await this._fetchDetailPageLinks(r._detailURL, headers);
        if (links.length > 0) {
          r.links = links;
        }
      } catch (e) {
        // ignore detail fetch errors
      }
    });

    await Promise.all(tasks);
  }

  /**
   * Fetch a detail page and extract tianyi cloud links
   */
  async _fetchDetailPageLinks(
    detailURL: string,
    headers: Record<string, string>,
  ): Promise<Link[]> {
    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: { ...headers, Referer: BASE_URL },
      },
      { timeout: 10000, retries: 1 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const links: Link[] = [];
    const seen = new Set<string>();

    // Extract tianyi links from href attributes
    $('.topicContent a[href*="cloud.189.cn"]').each(
      (i: number, el: any) => {
        const href = $(el).attr("href");
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push({ type: "tianyi", url: href, password: "" });
        }
      },
    );

    // If no links found via href, try extracting from text
    if (links.length === 0) {
      const content = $(".topicContent").text();
      return this._extractTianyiLinks(content);
    }

    return links;
  }
}

export default LeijingPlugin;
