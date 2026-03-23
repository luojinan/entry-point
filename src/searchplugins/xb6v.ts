import * as cheerio from 'cheerio';
import {
  BasePlugin,
  fetchWithRetry,
  fetchWithTimeout,
  filterByKeyword,
} from "./base";
import type { Link, SearchResult } from "./types";

const PLUGIN_NAME = "xb6v";
const BASE_URL = "https://www.66ss.org";
const SEARCH_PATH = "/e/search/1index.php";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const MAX_RESULTS = 50;

const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

interface DetailPage {
  url: string;
  datetime: string;
}

interface MagnetLinkInfo {
  url: string;
  subTitle: string;
}

export default class Xb6vPlugin extends BasePlugin {
  private currentBase: string;

  constructor() {
    super(PLUGIN_NAME, 3);
    this.currentBase = BASE_URL;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    let decodedKeyword: string;
    try {
      decodedKeyword = decodeURIComponent(keyword);
    } catch (e) {
      decodedKeyword = keyword;
    }

    const spaceIndex = decodedKeyword.indexOf(" ");
    if (spaceIndex > 0) {
      decodedKeyword = decodedKeyword.substring(0, spaceIndex);
    }

    keyword = decodedKeyword;

    const searchURL = this.currentBase + SEARCH_PATH;
    const postData = `show=title&tempid=1&tbname=article&mid=1&dopost=search&submit=&keyboard=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithTimeout(
      searchURL,
      {
        method: "POST",
        headers: {
          ...HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: this.currentBase,
        },
        body: postData,
        redirect: "manual",
      } as RequestInit,
      30000,
    );

    let location = resp.headers.get("location") || "";

    if (!location) {
      const bodyStr = await resp.text();

      let match = bodyStr.match(/location\.href\s*=\s*["']([^"']+)["']/);
      if (match) {
        location = match[1];
      }

      if (!location) {
        match = bodyStr.match(
          /(?:href|url)\s*[=:]\s*["']?([^"'\s]*searchid=[^"'\s&]+)/,
        );
        if (match) {
          location = match[1];
        }
      }

      if (!location) {
        match = bodyStr.match(/result\/\?searchid=\d+/);
        if (match) {
          location = match[0];
        }
      }

      if (!location) {
        throw new Error("No search result redirect found");
      }
    }

    let resultURL: string;
    if (location.startsWith("result/")) {
      resultURL = this.currentBase + "/e/search/" + location;
    } else {
      resultURL = this.currentBase + "/" + location.replace(/^\//, "");
    }

    const resp2 = await fetchWithRetry(
      resultURL,
      {
        headers: { ...HEADERS, Referer: this.currentBase },
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp2.text();
    const $ = cheerio.load(html);

    const detailPages = this.extractDetailURLs($);

    if (detailPages.length === 0) {
      return [];
    }

    const limitedPages = detailPages.slice(0, MAX_RESULTS);

    const results = await this.fetchMagnetLinksFromDetails(
      limitedPages,
      keyword,
    );

    const validResults = results.filter((r) => r.links.length > 0);

    return filterByKeyword(validResults, keyword);
  }

  private extractDetailURLs($: cheerio.CheerioAPI): DetailPage[] {
    const detailPages: DetailPage[] = [];
    const urlMap = new Set<string>();

    $("ul#post_container li.post").each((i, el) => {
      const li = $(el);
      const linkEl = li.find("a[href*='.html']");
      if (linkEl.length === 0) return;

      const href = linkEl.attr("href");
      if (!href) return;

      if (!this.isValidContentURL(href)) return;

      let fullURL: string;
      if (href.startsWith("http://") || href.startsWith("https://")) {
        fullURL = href;
      } else {
        fullURL = this.currentBase + "/" + href.replace(/^\//, "");
      }

      if (urlMap.has(fullURL)) return;

      const dateText = li.find(".info .info_date").text().trim();
      let publishDate = new Date().toISOString();
      if (dateText) {
        const parsed = new Date(dateText);
        if (!isNaN(parsed.getTime())) {
          publishDate = parsed.toISOString();
        }
      }

      urlMap.add(fullURL);
      detailPages.push({ url: fullURL, datetime: publishDate });
    });

    return detailPages;
  }

  private isValidContentURL(href: string): boolean {
    const parts = href.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return false;

    const lastPart = parts[parts.length - 1];
    if (!lastPart.endsWith(".html")) return false;

    const nameWithoutExt = lastPart.replace(".html", "");
    return /\d+/.test(nameWithoutExt);
  }

  private async fetchMagnetLinksFromDetails(
    detailPages: DetailPage[],
    keyword: string,
  ): Promise<SearchResult[]> {
    const tasks = detailPages.map(
      async (pageInfo, idx): Promise<SearchResult[]> => {
        try {
          await new Promise((r) => setTimeout(r, idx * 100));
          return await this.fetchDetailPageMagnetLinks(
            pageInfo.url,
            pageInfo.datetime,
          );
        } catch (e) {
          return [];
        }
      },
    );

    const results = await Promise.all(tasks);
    return results.flat();
  }

  private async fetchDetailPageMagnetLinks(
    detailURL: string,
    publishDate: string,
  ): Promise<SearchResult[]> {
    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: { ...HEADERS, Referer: this.currentBase },
      },
      { timeout: 30000, retries: 1 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    let title = $("h1").text().trim() || "未知标题";
    title = this.cleanTitle(title);

    const category = $(".info_category a").text().trim();

    const magnetLinksInfo = this.extractMagnetLinks($, title);

    if (magnetLinksInfo.length === 0) return [];

    const results: SearchResult[] = [];
    for (let i = 0; i < magnetLinksInfo.length; i++) {
      const linkInfo = magnetLinksInfo[i];
      const resourceID = this.extractResourceID(detailURL) + "-" + i;
      const resultTitle = `${title}-${linkInfo.subTitle}`;

      results.push({
        uniqueId: `${PLUGIN_NAME}-${resourceID}`,
        title: resultTitle,
        content: `分类：${category}\n磁力链接：${linkInfo.subTitle}`,
        links: [{ type: "magnet", url: linkInfo.url, password: "" }],
        datetime: publishDate,
        tags: category ? [category] : [],
        channel: "",
      });
    }

    return results;
  }

  private extractMagnetLinks(
    $: cheerio.CheerioAPI,
    mainTitle: string,
  ): MagnetLinkInfo[] {
    const linkInfos: MagnetLinkInfo[] = [];
    const linkMap = new Set<string>();

    $("td").each((i, el) => {
      const s = $(el);
      const text = s.text();
      if (text.includes("磁力：")) {
        s.find("a[href^='magnet:']").each((j, a) => {
          const href = $(a).attr("href");
          if (!href || linkMap.has(href)) return;
          linkMap.add(href);

          const subTitle = $(a).text().trim() || "磁力链接";
          linkInfos.push({ url: href, subTitle });
        });
      }
    });

    if (linkInfos.length === 0) {
      $("a[href^='magnet:']").each((i, el) => {
        const href = $(el).attr("href");
        if (!href || linkMap.has(href)) return;
        linkMap.add(href);

        const subTitle = $(el).text().trim() || "磁力链接";
        linkInfos.push({ url: href, subTitle });
      });
    }

    return linkInfos;
  }

  private extractResourceID(detailURL: string): string {
    const match = detailURL.match(/\/(\d+)\.html/);
    return match ? match[1] : String(Date.now());
  }

  private cleanTitle(title: string): string {
    const cleaners = ["6v电影-新版", "6v电影", "新版6v", "新版6V", "6V电影"];
    let cleaned = title;
    for (const cleaner of cleaners) {
      if (cleaned.startsWith(cleaner)) {
        cleaned = cleaned
          .substring(cleaner.length)
          .replace(/^[\s\t\u3000]+/, "");
      }
      if (cleaned.endsWith(cleaner)) {
        cleaned = cleaned
          .substring(0, cleaned.length - cleaner.length)
          .replace(/[\s\t\u3000]+$/, "");
      }
      if (cleaned.includes(cleaner)) {
        const parts = cleaned
          .split(cleaner)
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length > 0) {
          cleaned = parts.join(" ");
        }
      }
    }
    cleaned = cleaned.trim().replace(/\s+/g, " ");
    return cleaned || "未知标题";
  }
}
