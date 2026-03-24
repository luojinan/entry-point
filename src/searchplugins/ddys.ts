import * as cheerio from 'cheerio';
import {
  BasePlugin,
  determineCloudType,
  fetchWithRetry,
  filterByKeyword,
  generateUniqueID,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://ddys.pro";
const SEARCH_PATH = "/?s=%s&post_type=post";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const MAX_RESULTS = 50;
const MAX_CONCURRENT = 20;

/**
 * ddys - 低端影视插件
 * 影视资源网盘链接搜索，从搜索结果页获取列表，再并发获取详情页提取网盘链接
 */
class Ddys extends BasePlugin {
  constructor() {
    super("ddys", 1);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Step 1: Execute search
    const searchResults = await this._executeSearch(keyword);
    if (searchResults.length === 0) return [];

    // Step 2: Fetch detail page links concurrently
    const finalResults = await this._fetchDetailLinks(searchResults);

    // Step 3: Keyword filter
    return filterByKeyword(finalResults, keyword);
  }

  private async _executeSearch(
    keyword: string,
  ): Promise<Array<SearchResult & { _detailURL?: string }>> {
    const searchURL = `${BASE_URL}/?s=${encodeURIComponent(keyword)}&post_type=post`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        method: "GET",
        headers: this._getHeaders(),
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this._parseSearchResults($);
  }

  private _getHeaders(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      Referer: BASE_URL + "/",
    };
  }

  private _parseSearchResults(
    $: cheerio.CheerioAPI,
  ): Array<SearchResult & { _detailURL?: string }> {
    const results: Array<SearchResult & { _detailURL?: string }> = [];

    $("article[class*='post-']").each((i, el) => {
      if (results.length >= MAX_RESULTS) return false;

      const result = this._parseResultItem($, el, i + 1);
      if (result) {
        results.push(result);
      }
    });

    return results;
  }

  private _parseResultItem(
    $: cheerio.CheerioAPI,
    el: cheerio.Element,
    index: number,
  ): (SearchResult & { _detailURL?: string }) | null {
    const $el = $(el);

    // Extract post ID from article class
    const articleClass = $el.attr("class") || "";
    const postIDMatch = articleClass.match(/post-(\d+)/);
    const postID = postIDMatch ? postIDMatch[1] : `unknown-${index}`;

    // Extract title and link
    const $linkEl = $el.find(".post-title a");
    if ($linkEl.length === 0) return null;

    const title = ($linkEl.text() || "").trim();
    if (!title) return null;

    const detailURL = $linkEl.attr("href");
    if (!detailURL) return null;

    // Extract publish time
    const $timeEl = $el.find(".meta_date time.entry-date");
    let datetime = new Date().toISOString();
    if ($timeEl.length > 0) {
      const datetimeAttr = $timeEl.attr("datetime");
      if (datetimeAttr) {
        datetime = datetimeAttr;
      }
    }

    // Extract category
    const $categoryEl = $el.find(".meta_categories .cat-links a");
    const category =
      $categoryEl.length > 0 ? ($categoryEl.text() || "").trim() : "未分类";

    // Extract content snippet
    const $contentEl = $el.find(".entry-content");
    let content = "";
    if ($contentEl.length > 0) {
      content = ($contentEl.text() || "").trim();
      if (content.length > 200) {
        content = content.substring(0, 200) + "...";
      }
    }

    return {
      uniqueId: `ddys-${postID}-${index}`,
      title,
      content: `分类：${category}\n${content}`,
      links: [],
      datetime,
      tags: [category],
      channel: "",
      _detailURL: detailURL,
    };
  }

  private async _fetchDetailLinks(
    searchResults: Array<SearchResult & { _detailURL?: string }>,
  ): Promise<SearchResult[]> {
    const finalResults: SearchResult[] = [];

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < searchResults.length; i += MAX_CONCURRENT) {
      const batch = searchResults.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (result) => {
          const detailURL = result._detailURL;
          if (!detailURL) return null;

          const links = await this._fetchDetailPageLinks(detailURL);
          if (links.length > 0) {
            const { _detailURL, ...cleanResult } = result;
            return { ...cleanResult, links };
          }
          return null;
        }),
      );

      for (const res of batchResults) {
        if (res.status === "fulfilled" && res.value) {
          finalResults.push(res.value);
        }
      }
    }

    return finalResults;
  }

  private async _fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Referer: BASE_URL + "/",
          },
        },
        { timeout: 30000, retries: 2 },
      );

      const htmlContent = await resp.text();
      return this._parseNetworkDiskLinks(htmlContent);
    } catch (err) {
      return [];
    }
  }

  private _parseNetworkDiskLinks(htmlContent: string): Link[] {
    const links: Link[] = [];
    const seen = new Set<string>();

    // Define link patterns
    const patterns = [
      {
        name: "夸克网盘",
        pattern:
          /\(夸克[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g,
        urlType: "quark" as CloudType,
      },
      {
        name: "百度网盘",
        pattern:
          /\(百度[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g,
        urlType: "baidu" as CloudType,
      },
      {
        name: "阿里云盘",
        pattern:
          /\(阿里[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g,
        urlType: "aliyun" as CloudType,
      },
      {
        name: "天翼云盘",
        pattern:
          /\(天翼[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g,
        urlType: "tianyi" as CloudType,
      },
      {
        name: "迅雷网盘",
        pattern:
          /\(迅雷[^)]*\)[：:]\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/a>/g,
        urlType: "xunlei" as CloudType,
      },
      {
        name: "通用网盘",
        pattern:
          /<a[^>]*href\s*=\s*["'](https?:\/\/[^"']*(?:pan|drive|cloud)[^"']*)["'][^>]*>([^<]+)<\/a>/g,
        urlType: "others" as CloudType,
      },
    ];

    for (const pat of patterns) {
      let match: RegExpExecArray | null = pat.pattern.exec(htmlContent);
      while (match !== null) {
        const url = match[1];
        if (seen.has(url)) {
          match = pat.pattern.exec(htmlContent);
          continue;
        }
        seen.add(url);

        let urlType = determineCloudType(url);
        if (urlType === "others") {
          urlType = pat.urlType;
        }

        // Also check lanzou
        if (url.includes("lanzou")) {
          urlType = "lanzou" as CloudType;
        }

        const password = this._extractPassword(htmlContent, url);

        links.push({ type: urlType, url, password });
        match = pat.pattern.exec(htmlContent);
      }
    }

    return links;
  }

  private _extractPassword(content: string, panURL: string): string {
    const patterns = [
      /提取[码密][：:]?\s*([A-Za-z0-9]{4,8})/,
      /密码[：:]?\s*([A-Za-z0-9]{4,8})/,
      /[码密][：:]?\s*([A-Za-z0-9]{4,8})/,
      /([A-Za-z0-9]{4,8})\s*[是为]?提取[码密]/,
    ];

    const urlIndex = content.indexOf(panURL);
    if (urlIndex === -1) return "";

    const start = Math.max(0, urlIndex - 200);
    const end = Math.min(content.length, urlIndex + panURL.length + 200);
    const searchArea = content.substring(start, end);

    for (const p of patterns) {
      const m = searchArea.match(p);
      if (m) return m[1];
    }

    return "";
  }
}

export default Ddys;
