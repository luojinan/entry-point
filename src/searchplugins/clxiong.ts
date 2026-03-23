import * as cheerio from 'cheerio';
import { BasePlugin, fetchWithTimeout, filterByKeyword } from "./base";
import type { Link, SearchResult } from "./types";

/**
 * clxiong 插件 - 磁力熊 (cilixiong.org)
 * 两步搜索: POST获取searchID -> GET搜索结果 -> 并发获取详情页磁力链接
 */
class ClxiongPlugin extends BasePlugin {
  private baseURL: string;
  private searchURL: string;
  private ua: string;
  private maxRetries: number;
  private retryDelay: number;
  private maxResults: number;

  constructor() {
    super("clxiong", 2);
    this.baseURL = "https://www.cilixiong.org";
    this.searchURL = "https://www.cilixiong.org/e/search/index.php";
    this.ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
    this.maxRetries = 3;
    this.retryDelay = 2000;
    this.maxResults = 30;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Step 1: POST search to get searchID
    const searchID = await this._getSearchID(keyword);

    // Step 2: GET search results page
    const results = await this._getSearchResults(searchID);

    // Step 3: Fetch detail pages for magnet links
    const enrichedResults = await this._fetchDetailLinks(results);

    return filterByKeyword(enrichedResults, keyword);
  }

  private async _getSearchID(keyword: string): Promise<string> {
    const formData = new URLSearchParams();
    formData.set("classid", "1,2");
    formData.set("show", "title");
    formData.set("tempid", "1");
    formData.set("keyboard", keyword);

    let resp: Response | undefined;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        resp = await fetchWithTimeout(
          this.searchURL,
          {
            method: "POST",
            headers: {
              "User-Agent": this.ua,
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: `${this.baseURL}/`,
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
            body: formData.toString(),
            redirect: "manual", // Don't follow redirects automatically
          },
          30000,
        );

        if (resp.status === 302 || resp.status === 301) break;
      } catch (e) {
        if (i === this.maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, this.retryDelay));
      }
    }

    if (!resp || (resp.status !== 302 && resp.status !== 301)) {
      throw new Error(
        `Expected 302 redirect but got status: ${resp ? resp.status : "no response"}`,
      );
    }

    const location = resp.headers.get("location") || "";
    const searchIDMatch = /searchid=(\d+)/.exec(location);
    if (!searchIDMatch) {
      throw new Error(`Cannot extract searchid from Location: ${location}`);
    }

    return searchIDMatch[1];
  }

  private async _getSearchResults(
    searchID: string,
  ): Promise<Array<SearchResult & { _detailURL?: string }>> {
    const resultURL = `${this.baseURL}/e/search/result/?searchid=${searchID}`;

    let resp: Response | undefined;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        resp = await fetchWithTimeout(
          resultURL,
          {
            headers: {
              "User-Agent": this.ua,
              Referer: `${this.baseURL}/`,
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
          },
          30000,
        );

        if (resp.ok) break;
      } catch (e) {
        if (i === this.maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, this.retryDelay));
      }
    }

    if (!resp || !resp.ok) {
      throw new Error(
        `Search results request failed: ${resp ? resp.status : "no response"}`,
      );
    }

    const html = await resp.text();
    return this._parseSearchResults(html);
  }

  private _parseSearchResults(
    html: string,
  ): Array<SearchResult & { _detailURL?: string }> {
    const $ = cheerio.load(html);
    const results: Array<SearchResult & { _detailURL?: string }> = [];

    $(".row.row-cols-2.row-cols-lg-4 .col").each((i, el) => {
      if (i >= this.maxResults) return;

      const linkEl = $(el).find("a[href*='/drama/'], a[href*='/movie/']");
      if (linkEl.length === 0) return;

      const detailPath = linkEl.attr("href");
      if (!detailPath) return;

      const detailURL = this.baseURL + detailPath;
      const title = linkEl.find("h2.h4").text().trim();
      if (!title) return;

      const rating = $(el).find(".rank").text().trim();
      const year = $(el).find(".small").last().text().trim();

      let poster = "";
      const cardImg = $(el).find(".card-img");
      if (cardImg.length > 0) {
        const style = cardImg.attr("style") || "";
        const imgMatch = /url\(['"]?([^'"]+)['"]?\)/.exec(style);
        if (imgMatch) poster = imgMatch[1];
      }

      // Build content
      const contentParts: string[] = [];
      if (rating) contentParts.push(`评分: ${rating}`);
      if (year) contentParts.push(`年份: ${year}`);
      if (poster) contentParts.push(`海报: ${poster}`);
      contentParts.push(`详情页: ${detailURL}`);
      const content = contentParts.join(" | ");

      // Generate unique ID
      const idMatch = /\/(?:drama|movie)\/(\d+)\.html/.exec(detailPath);
      let uniqueId: string;
      if (idMatch) {
        uniqueId = `clxiong-${idMatch[1]}`;
      } else {
        let hash = 0;
        for (const ch of detailPath) hash = hash * 31 + ch.charCodeAt(0);
        if (hash < 0) hash = -hash;
        uniqueId = `clxiong-${hash}`;
      }

      results.push({
        uniqueId,
        title,
        content,
        links: [],
        datetime: new Date().toISOString(),
        tags: ["磁力链接", "影视"],
        channel: "",
        _detailURL: detailURL,
      });
    });

    return results;
  }

  private async _fetchDetailLinks(
    results: Array<SearchResult & { _detailURL?: string }>,
  ): Promise<SearchResult[]> {
    if (results.length === 0) return results;

    const enrichPromises = results.map(async (result) => {
      const detailURL = result._detailURL;
      if (!detailURL) return result;

      try {
        const detailInfo = await this._fetchDetailPageInfo(
          detailURL,
          result.title,
        );
        if (!detailInfo || detailInfo.magnetLinks.length === 0) return result;

        // Create results: one per magnet link
        const expandedResults: SearchResult[] = [];

        for (let i = 0; i < detailInfo.magnetLinks.length; i++) {
          const newResult: SearchResult = {
            uniqueId: i === 0 ? result.uniqueId : `${result.uniqueId}-${i + 1}`,
            title:
              i < detailInfo.fileNames.length
                ? `${result.title}-${detailInfo.fileNames[i]}`
                : result.title,
            content: result.content,
            links: [detailInfo.magnetLinks[i]],
            datetime: detailInfo.updateTime || result.datetime,
            tags: result.tags,
            channel: "",
          };
          expandedResults.push(newResult);
        }

        return expandedResults;
      } catch (e) {
        return result;
      }
    });

    const enrichedArrays = await Promise.all(enrichPromises);

    // Flatten
    const finalResults: SearchResult[] = [];
    for (const item of enrichedArrays) {
      if (Array.isArray(item)) {
        finalResults.push(...item);
      } else {
        // Only include if it has links
        if (item.links && item.links.length > 0) {
          delete item._detailURL;
          finalResults.push(item);
        }
      }
    }

    return finalResults;
  }

  private async _fetchDetailPageInfo(
    detailURL: string,
    movieTitle: string,
  ): Promise<{
    magnetLinks: Link[];
    fileNames: string[];
    updateTime: string;
    title: string;
  } | null> {
    const resp = await fetchWithTimeout(
      detailURL,
      {
        headers: {
          "User-Agent": this.ua,
          Referer: `${this.baseURL}/`,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
      },
      20000,
    );

    if (!resp.ok) return null;

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Parse update time
    let updateTime = "";
    $(".mv_detail p").each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes("最后更新于：")) {
        const dateStr = text.replace("最后更新于：", "").trim();
        updateTime = dateStr;
      }
    });

    // Parse magnet links
    const magnetLinks: Link[] = [];
    const fileNames: string[] = [];
    $('.mv_down a[href^="magnet:"]').each((i, el) => {
      const href = $(el).attr("href");
      if (href) {
        const fileName = $(el).text().trim();
        magnetLinks.push({ type: "magnet", url: href, password: "" });
        fileNames.push(fileName);
      }
    });

    return { magnetLinks, fileNames, updateTime, title: movieTitle };
  }
}

export default ClxiongPlugin;
