import cheerio, { type CheerioAPI } from "cheerio";
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
import type { Link, SearchResult } from "./types";

const PLUGIN_NAME = "javdb";
const BASE_URL = "https://javdb.com";
const SEARCH_PATH = "/search?q=%s&f=all";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const MAX_RESULTS = 50;

interface SearchResultWithDetail extends SearchResult {
  _detailURL: string;
}

class JavdbPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 5);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Step 1: Execute search
    const searchResults = await this.executeSearch(keyword);

    if (searchResults.length === 0) {
      return [];
    }

    // Step 2: Concurrently fetch detail page magnet links
    const finalResults = await this.fetchDetailMagnetLinks(searchResults);

    return finalResults;
  }

  private async executeSearch(
    keyword: string,
  ): Promise<SearchResultWithDetail[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH.replace("%s", encodeURIComponent(keyword))}`;

    const resp = await fetchWithTimeout(
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
      30000,
    );

    if (resp.status === 429) {
      return [];
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.parseSearchResults($);
  }

  private parseSearchResults($: CheerioAPI): SearchResultWithDetail[] {
    const results: SearchResultWithDetail[] = [];

    $(".movie-list .item").each((i, el) => {
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
    const linkEl = s.find("a.box");
    if (linkEl.length === 0) return null;

    let detailURL = linkEl.attr("href") || "";
    const title = linkEl.attr("title") || "";

    if (!detailURL || !title) return null;

    if (detailURL.startsWith("/")) {
      detailURL = BASE_URL + detailURL;
    }

    // Extract video number
    const videoTitleEl = s.find(".video-title");
    let videoNumber = "";
    if (videoTitleEl.length > 0) {
      const strongEl = videoTitleEl.find("strong");
      if (strongEl.length > 0) {
        videoNumber = strongEl.text().trim();
      }
    }

    // Extract rating
    let rating = "";
    const ratingEl = s.find(".score .value");
    if (ratingEl.length > 0) {
      rating = ratingEl.text().trim().replace(/\n/g, " ").replace(/\s+/g, " ");
    }

    // Extract release date
    let releaseDate = "";
    const metaEl = s.find(".meta");
    if (metaEl.length > 0) {
      releaseDate = metaEl.text().trim();
    }

    // Extract tags
    const tags: string[] = [];
    s.find(".tags .tag").each((i: number, tagEl: any) => {
      const tag = $(tagEl).text().trim();
      if (tag) tags.push(tag);
    });

    // Build content
    const contentParts: string[] = [];
    if (videoNumber) contentParts.push(`\u756A\u865F\uFF1A${videoNumber}`);
    if (rating) contentParts.push(`\u8A55\u5206\uFF1A${rating}`);
    if (releaseDate)
      contentParts.push(`\u767C\u5E03\u65E5\u671F\uFF1A${releaseDate}`);
    if (tags.length > 0)
      contentParts.push(`\u6A19\u7C64\uFF1A${tags.join(" ")}`);

    const content = contentParts.join("\n");

    // Parse datetime
    let datetime = new Date().toISOString();
    if (releaseDate) {
      const parsed = new Date(releaseDate);
      if (!isNaN(parsed.getTime())) {
        datetime = parsed.toISOString();
      }
    }

    return {
      _detailURL: detailURL,
      title: title.trim().replace(/\s+/g, " "),
      content,
      channel: "",
      uniqueId: `${PLUGIN_NAME}-${index}`,
      datetime,
      links: [],
      tags,
    };
  }

  private async fetchDetailMagnetLinks(
    searchResults: SearchResultWithDetail[],
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    const tasks = searchResults.map(async (result) => {
      const detailURL = result._detailURL;
      if (!detailURL) return [];

      try {
        const magnetLinks = await this.fetchDetailPageMagnetLinks(detailURL);

        if (magnetLinks.length > 0) {
          // Create one result per magnet link
          return magnetLinks.map((link) => {
            const linkHash = crypto
              .createHash("md5")
              .update(link.url)
              .digest("hex")
              .substring(0, 8);
            const { _detailURL, ...cleanResult } = result;
            return {
              ...cleanResult,
              links: [link],
              uniqueId: `${result.uniqueId}-magnet-${linkHash}`,
            };
          });
        }
      } catch (e) {
        // skip failed detail pages
      }
      return [];
    });

    const settled = await Promise.all(tasks);
    for (const resultSet of settled) {
      allResults.push(...resultSet);
    }

    return allResults;
  }

  private async fetchDetailPageMagnetLinks(detailURL: string): Promise<Link[]> {
    try {
      const resp = await fetchWithTimeout(
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
        30000,
      );

      if (resp.status === 429) return [];
      if (!resp.ok) return [];

      const html = await resp.text();
      return this.parseMagnetLinks(html);
    } catch (e) {
      return [];
    }
  }

  private parseMagnetLinks(htmlContent: string): Link[] {
    const links: Link[] = [];
    const $ = cheerio.load(htmlContent);

    $(".magnet-links .item").each((i, el) => {
      const magnetEl = $(el).find(".magnet-name a");
      if (magnetEl.length === 0) return;

      let magnetURL = magnetEl.attr("href") || "";
      if (!magnetURL) return;

      if (!magnetURL.startsWith("magnet:")) return;

      // Decode HTML entities
      magnetURL = magnetURL.replace(/&amp;/g, "&");

      links.push({
        type: "magnet",
        url: magnetURL,
        password: "",
      });
    });

    return links;
  }
}

export default JavdbPlugin;
