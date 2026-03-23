import * as cheerio from 'cheerio';
import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "pianku";
const BASE_URL = "https://btnull.pro";
const SEARCH_PATH = "/search/-------------.html";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// Pre-compiled regex patterns (matching the Go source exactly)
const movieIDRegex = /\/movie\/(\d+)\.html/;
const yearRegex = /\((\d{4})\)/;
const regionTypeRegex = /地区：([^　]*?)　+类型：(.*)/;

const magnetLinkRegex = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s]*/;
const ed2kLinkRegex = /ed2k:\/\/\|file\|[^|]+\|[^|]+\|[^|]+\|\/?/;

const panLinkRegexes: Record<string, RegExp> = {
  baidu:
    /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?(?:&v=\d+)?/,
  aliyun: /https?:\/\/(?:www\.)?alipan\.com\/s\/[0-9a-zA-Z_-]+/,
  tianyi: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z_-]+(?:\([^)]*\))?/,
  uc: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-fA-F]+(?:\?[^"\s]*)?/,
  mobile: /https?:\/\/caiyun\.139\.com\/[^"\s]+/,
  "115": /https?:\/\/(?:115\.com|115cdn\.com)\/s\/[0-9a-zA-Z_-]+(?:\?[^"\s]*)?/,
  pikpak: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z_-]+/,
  xunlei:
    /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?/,
  "123":
    /https?:\/\/(?:www\.)?(?:123pan\.com|123684\.com)\/s\/[0-9a-zA-Z_-]+(?:\?[^"\s]*)?/,
  quark: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-fA-F]+(?:\?pwd=[0-9a-zA-Z]+)?/,
};

const passwordRegexes = [
  /[?&]pwd=([0-9a-zA-Z]+)/,
  /[?&]password=([0-9a-zA-Z]+)/,
  /提取码[：:]\s*([0-9a-zA-Z]+)/,
  /访问码[：:]\s*([0-9a-zA-Z]+)/,
  /密码[：:]\s*([0-9a-zA-Z]+)/,
  /验证码[：:]\s*([0-9a-zA-Z]+)/,
  /口令[：:]\s*([0-9a-zA-Z]+)/,
  /（访问码[：:]\s*([0-9a-zA-Z]+)）/,
];

class PiankuPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  /**
   * Build common request headers
   */
  private _headers(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      Referer: BASE_URL + "/",
    };
  }

  /**
   * Main search method
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Handle ext: prefer title_en if available
    let searchKeyword = keyword;
    if (
      ext &&
      ext.title_en &&
      typeof ext.title_en === "string" &&
      ext.title_en !== ""
    ) {
      searchKeyword = ext.title_en;
    }

    const searchURL = `${BASE_URL}${SEARCH_PATH}?wd=${encodeURIComponent(searchKeyword)}`;

    // Fetch search page
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: this._headers(),
      },
      { timeout: TIMEOUT_MS, retries: MAX_RETRIES - 1 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract search results (basic info + detail page URL)
    const searchResults = this.extractSearchResults($);

    // Fetch detail pages concurrently to get download links
    const tasks = searchResults.map(async (result) => {
      if (result.links.length === 0) return null;

      const detailURL = result.links[0].url;

      try {
        const downloadLinks = await this.fetchDetailPageLinks(detailURL);
        if (downloadLinks.length > 0) {
          result.links = downloadLinks;
          return result;
        }
      } catch (e) {
        // If detail page fails, still return the original result
        return result;
      }
      return null;
    });

    const settled = await Promise.all(tasks);
    const finalResults = settled.filter(Boolean) as SearchResult[];

    // Filter by keyword
    return filterByKeyword(finalResults, searchKeyword);
  }

  /**
   * Extract search results from the search page HTML
   */
  private extractSearchResults($: cheerio.CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];

    $(".sr_lists dl").each((i, el) => {
      const result = this.extractSingleResult($, $(el));
      if (result && result.uniqueId && result.links.length > 0) {
        results.push(result);
      }
    });

    return results;
  }

  /**
   * Extract a single search result item
   */
  private extractSingleResult(
    $: cheerio.CheerioAPI,
    s: cheerio.Cheerio<cheerio.Element>,
  ): SearchResult | null {
    // Extract link and movie ID
    const linkEl = s.find("dt a");
    const link = linkEl.attr("href");
    if (!link) return null;

    const movieID = this.extractMovieID(link);
    if (!movieID) return null;

    // Extract title
    const title = s.find("dd p:first-child strong a").text().trim();
    if (!title) return null;

    // Extract status tag
    const status = s.find("dd p:first-child span.ss1").text().trim();

    // Parse detailed info
    let actors = "";
    let description = "";
    let region = "";
    let types = "";
    let altName = "";

    s.find("dd p").each((j, pEl) => {
      const text = $(pEl).text().trim();

      if (text.startsWith("又名：")) {
        altName = text.replace(/^又名：/, "");
      } else if (text.includes("地区：") && text.includes("类型：")) {
        const parsed = this.parseRegionAndTypes(text);
        region = parsed.region;
        types = parsed.types;
      } else if (text.startsWith("主演：")) {
        actors = text.replace(/^主演：/, "");
      } else if (text.startsWith("简介：")) {
        description = text.replace(/^简介：/, "");
      } else if (
        !text.includes("名称：") &&
        !text.includes("又名：") &&
        !text.includes("地区：") &&
        !text.includes("主演：") &&
        text !== ""
      ) {
        // May be a description without prefix
        if (description === "" && text.length > 10) {
          description = text;
        }
      }
    });

    // Build full detail URL
    const fullLink = this.buildFullURL(link);

    // Build tags
    const tags: string[] = [];
    if (region) {
      tags.push(region);
    }
    if (types) {
      const typeList = types.split(",");
      for (const t of typeList) {
        const trimmed = t.trim();
        if (trimmed) tags.push(trimmed);
      }
    }
    if (status) {
      tags.push(status);
    }

    // Build content description
    let content = description;
    if (actors && content) {
      content = `主演：${actors}\n${content}`;
    } else if (actors) {
      content = `主演：${actors}`;
    }
    if (altName) {
      if (content) {
        content = `又名：${altName}\n${content}`;
      } else {
        content = `又名：${altName}`;
      }
    }

    return {
      uniqueId: `${PLUGIN_NAME}-${movieID}`,
      title,
      content,
      links: [{ type: "others" as CloudType, url: fullLink, password: "" }],
      channel: "",
      datetime: new Date().toISOString(),
      tags,
    };
  }

  /**
   * Extract movie ID from URL path
   */
  private extractMovieID(url: string): string {
    const matches = url.match(movieIDRegex);
    if (matches && matches.length > 1) {
      return matches[1];
    }
    return "";
  }

  /**
   * Parse region and type info from text
   */
  private parseRegionAndTypes(text: string): { region: string; types: string } {
    const matches = text.match(regionTypeRegex);
    if (matches && matches.length > 2) {
      return {
        region: matches[1].trim(),
        types: matches[2].trim(),
      };
    }
    return { region: "", types: "" };
  }

  /**
   * Build full URL from a possibly relative path
   */
  private buildFullURL(path: string): string {
    if (path.startsWith("http")) {
      return path;
    }
    return BASE_URL + path;
  }

  /**
   * Fetch detail page and extract download links
   */
  private async fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: this._headers(),
      },
      { timeout: TIMEOUT_MS, retries: MAX_RETRIES - 1 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.extractDownloadLinks($);
  }

  /**
   * Extract download links from the detail page HTML
   */
  private extractDownloadLinks($: cheerio.CheerioAPI): Link[] {
    const links: Link[] = [];
    const seenURLs = new Set<string>();

    $("#donLink .down-list2").each((i, el) => {
      const aEl = $(el).find(".down-list3 a");
      const linkURL = (aEl.attr("href") || "").trim();
      if (!linkURL) return;

      const linkTitle = aEl.text().trim();
      if (!linkTitle) return;

      // Validate link
      if (!this.isValidLink(linkURL)) return;

      // Dedup
      if (seenURLs.has(linkURL)) return;
      seenURLs.add(linkURL);

      // Determine link type
      const linkType = this.determineLinkType(linkURL) as CloudType;

      // Extract password
      const password = this.extractLinkPassword(linkURL, linkTitle);

      links.push({
        type: linkType,
        url: linkURL,
        password,
      });
    });

    return links;
  }

  /**
   * Check if a link is a valid download link (magnet, ed2k, or pan link)
   */
  private isValidLink(url: string): boolean {
    if (magnetLinkRegex.test(url)) return true;
    if (ed2kLinkRegex.test(url)) return true;

    for (const regex of Object.values(panLinkRegexes)) {
      if (regex.test(url)) return true;
    }

    return false;
  }

  /**
   * Determine the type of a download link
   */
  private determineLinkType(url: string): string {
    if (magnetLinkRegex.test(url)) return "magnet";
    if (ed2kLinkRegex.test(url)) return "ed2k";

    for (const [panType, regex] of Object.entries(panLinkRegexes)) {
      if (regex.test(url)) return panType;
    }

    return "others";
  }

  /**
   * Extract password from URL params or title text
   */
  private extractLinkPassword(url: string, title: string): string {
    // First try extracting from URL
    for (const regex of passwordRegexes) {
      const matches = url.match(regex);
      if (matches && matches.length > 1) {
        return matches[1];
      }
    }

    // Then try extracting from title text
    for (const regex of passwordRegexes) {
      const matches = title.match(regex);
      if (matches && matches.length > 1) {
        return matches[1];
      }
    }

    return "";
  }
}

export default PiankuPlugin;
