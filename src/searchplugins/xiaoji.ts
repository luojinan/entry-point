import * as cheerio from 'cheerio';
import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "xiaoji";
const BASE_URL = "https://www.xiaojitv.com";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  Referer: BASE_URL + "/",
  "Cache-Control": "max-age=0",
  "Upgrade-Insecure-Requests": "1",
};

const DETAIL_ID_REGEX = /\/(\d+)\.html/;
const GO_LINK_REGEX = /\/go\.html\?url=([A-Za-z0-9+/]+=*)/;

interface SearchResultWithDetail extends SearchResult {
  _detailURL?: string;
}

export default class XiaojiPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}/?s=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: HEADERS,
      },
      { timeout: 10000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const results = await this.parseSearchResults($, keyword);

    return filterByKeyword(results, keyword);
  }

  private async parseSearchResults(
    $: cheerio.CheerioAPI,
    keyword: string,
  ): Promise<SearchResult[]> {
    const items: SearchResultWithDetail[] = [];

    $("article.poster-item").each((i, el) => {
      const item = this.parseSearchResultItem($, $(el), keyword);
      if (item) items.push(item);
    });

    const tasks = items.map(async (item): Promise<SearchResult | null> => {
      try {
        const links = await this.fetchDetailPageLinks(item._detailURL || "");
        if (links.length > 0) {
          const { _detailURL, ...cleanItem } = item;
          cleanItem.links = links;
          return cleanItem;
        }
      } catch (e) {
        // skip
      }
      const { _detailURL, ...cleanItem } = item;
      return cleanItem;
    });

    const results = await Promise.all(tasks);
    return results.filter(
      (r): r is SearchResult => r !== null && r.links.length > 0,
    );
  }

  private parseSearchResultItem(
    $: cheerio.CheerioAPI,
    s: cheerio.Cheerio<cheerio.Element>,
    keyword: string,
  ): SearchResultWithDetail | null {
    const detailLink = s.find(".poster-link").attr("href");
    if (!detailLink) return null;

    const fullDetailLink = detailLink.startsWith("/")
      ? BASE_URL + detailLink
      : detailLink;

    const idMatch = fullDetailLink.match(DETAIL_ID_REGEX);
    if (!idMatch) return null;
    const resourceID = idMatch[1];

    const title = s.find(".poster-title a").text().trim();
    if (!title) return null;

    const rating = s.find(".rating-score").text().trim();

    const category = s.find(".poster-category a").text().trim();

    const tags: string[] = [];
    s.find(".poster-tags a").each((i, tagEl) => {
      const tag = $(tagEl).text().trim();
      if (tag) tags.push(tag);
    });

    let content = `分类: ${category}`;
    if (rating) content += ` | 评分: ${rating}`;
    if (tags.length > 0) content += ` | 标签: ${tags.join(", ")}`;

    return {
      uniqueId: `${PLUGIN_NAME}-${resourceID}`,
      title,
      content,
      links: [],
      datetime: new Date().toISOString(),
      tags,
      channel: "",
      _detailURL: fullDetailLink,
    };
  }

  private async fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          headers: HEADERS,
        },
        { timeout: 8000, retries: 3 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      return this.parseDetailPageLinks($);
    } catch (e) {
      return [];
    }
  }

  private parseDetailPageLinks($: cheerio.CheerioAPI): Link[] {
    const links: Link[] = [];
    const seenLinks = new Set<string>();

    $(".resource-compact-link a").each((i, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      let realURL = "";

      if (href.includes("/go.html?url=")) {
        realURL = this.decodeGoLink(href);
      } else if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("magnet:") ||
        href.startsWith("ed2k://")
      ) {
        realURL = href;
      }

      if (this.isValidURL(realURL) && !seenLinks.has(realURL)) {
        const linkType = this.determineCloudTypeLocal(realURL);
        links.push({ type: linkType, url: realURL, password: "" });
        seenLinks.add(realURL);
      }
    });

    return links;
  }

  private decodeGoLink(goLink: string): string {
    const match = goLink.match(GO_LINK_REGEX);
    if (!match) return "";

    let encoded = match[1].trim();
    if (!encoded) return "";

    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
      if (this.isValidURL(decoded)) return decoded;
    } catch (e) {
      encoded = encoded.replace(/ /g, "+");
      const paddingNeeded = (4 - (encoded.length % 4)) % 4;
      encoded += "=".repeat(paddingNeeded);
      try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
        if (this.isValidURL(decoded)) return decoded;
      } catch (e2) {
        // ignore
      }
    }

    return "";
  }

  private isValidURL(urlStr: string): boolean {
    if (!urlStr) return false;
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      if (urlStr.length <= 8) return false;
      return urlStr.substring(8).includes(".");
    }
    if (urlStr.startsWith("magnet:")) {
      return urlStr.length > 7 && urlStr.includes("xt=");
    }
    if (urlStr.startsWith("ed2k://")) {
      return urlStr.length > 7;
    }
    return false;
  }

  private determineCloudTypeLocal(url: string): CloudType {
    if (url.includes("pan.quark.cn")) return "quark";
    if (url.includes("drive.uc.cn")) return "uc";
    if (url.includes("pan.baidu.com")) return "baidu";
    if (url.includes("aliyundrive.com") || url.includes("alipan.com"))
      return "aliyun";
    if (url.includes("pan.xunlei.com")) return "xunlei";
    if (url.includes("cloud.189.cn")) return "tianyi";
    if (url.includes("115.com") || url.includes("115cdn.com")) return "115";
    if (url.includes("123pan.com")) return "123";
    if (url.includes("caiyun.139.com")) return "mobile";
    if (url.includes("mypikpak.com")) return "pikpak";
    if (url.includes("magnet:")) return "magnet" as CloudType;
    if (url.includes("ed2k://")) return "ed2k" as CloudType;
    return "others";
  }
}
