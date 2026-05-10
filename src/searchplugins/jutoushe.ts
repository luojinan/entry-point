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

const PLUGIN_NAME = "jutoushe";
const BASE_URL = "https://1.star2.cn";

class JutoushePlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 1);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}/search/?keyword=${encodeURIComponent(keyword)}`;

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
          Referer: BASE_URL + "/",
        },
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const results: SearchResult[] = [];

    // Process each search result item
    const items: Array<{
      uniqueId: string;
      title: string;
      detailURL: string;
      publishTime: string;
    }> = [];
    $("ul.erx-list li.item").each((i: number, el: any) => {
      const s = $(el);
      const linkElem = s.find(".a a.main");
      const title = linkElem.text().trim();
      const detailPath = linkElem.attr("href");

      if (!detailPath || !title) {
        return;
      }

      const detailURL = BASE_URL + detailPath;

      // Extract publish time
      const timeStr = s.find(".i span.time").text().trim();
      const publishTime = this.parseDate(timeStr);

      // Build unique ID
      const uniqueId = `${PLUGIN_NAME}-${this.extractIDFromURL(detailPath)}`;

      items.push({ uniqueId, title, detailURL, publishTime });
    });

    // Fetch detail links for each item
    const tasks = items.map(async (item) => {
      try {
        const links = await this.getDetailLinks(item.detailURL);
        if (links.length > 0) {
          return {
            uniqueId: item.uniqueId,
            title: item.title,
            content: `\u5267\u900F\u793E\u5F71\u89C6\u8D44\u6E90\uFF1A${item.title}`,
            datetime: item.publishTime,
            tags: this.extractTags(item.title),
            links,
            channel: "",
          };
        }
      } catch (e) {
        // skip
      }
      return null;
    });

    const settled = await Promise.all(tasks);
    const validResults = settled.filter(Boolean) as SearchResult[];

    return filterByKeyword(validResults, keyword);
  }

  async getDetailLinks(detailURL: string): Promise<Link[]> {
    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Referer: BASE_URL + "/",
          },
        },
        { timeout: 15000, retries: 1 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      const links: Link[] = [];

      $(".dlipp-cont-bd a.dlipp-dl-btn").each((i: number, el: any) => {
        const href = $(el).attr("href");
        if (!href) {
          return;
        }

        if (!this.isValidNetworkDriveURL(href)) {
          return;
        }

        const cloudType = this.determineCloudType(href);
        const password = this.extractPasswordFromURL(href);

        links.push({
          type: cloudType,
          url: href,
          password,
        });
      });

      return links;
    } catch (e) {
      return [];
    }
  }

  determineCloudType(url: string): CloudType {
    if (url.includes("pan.quark.cn")) {
      return "quark";
    }
    if (url.includes("drive.uc.cn")) {
      return "uc";
    }
    if (url.includes("pan.baidu.com")) {
      return "baidu";
    }
    if (url.includes("aliyundrive.com") || url.includes("alipan.com")) {
      return "aliyun";
    }
    if (url.includes("pan.xunlei.com")) {
      return "xunlei";
    }
    if (url.includes("cloud.189.cn")) {
      return "tianyi";
    }
    if (url.includes("115.com")) {
      return "115";
    }
    if (url.includes("123pan.com")) {
      return "123";
    }
    if (url.includes("caiyun.139.com")) {
      return "mobile";
    }
    if (url.includes("mypikpak.com")) {
      return "pikpak";
    }
    return "others";
  }

  extractPasswordFromURL(url: string): string {
    if (url.includes("pan.baidu.com") && url.includes("pwd=")) {
      const match = url.match(/pwd=([^&]+)/);
      if (match && match.length > 1) {
        return match[1];
      }
    }
    return "";
  }

  isValidNetworkDriveURL(url: string): boolean {
    if (!url) {
      return false;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return false;
    }

    const knownDomains = [
      "pan.quark.cn",
      "drive.uc.cn",
      "pan.baidu.com",
      "aliyundrive.com",
      "alipan.com",
      "pan.xunlei.com",
      "cloud.189.cn",
      "115.com",
      "123pan.com",
      "caiyun.139.com",
      "mypikpak.com",
    ];

    return knownDomains.some((domain) => url.includes(domain));
  }

  extractIDFromURL(urlPath: string): string {
    const match = urlPath.match(/\/([^/]+)\/(\d+)\.html/);
    if (match && match.length > 2) {
      return match[2];
    }
    return urlPath.replace(/\//g, "_");
  }

  extractTags(title: string): string[] {
    const tags: string[] = [];
    const categoryPattern = /\u3010([^\u3011]+)\u3011/g;
    let match: RegExpExecArray | null = categoryPattern.exec(title);
    while (match !== null) {
      if (match.length > 1) {
        tags.push(match[1]);
      }
      match = categoryPattern.exec(title);
    }

    if (tags.length === 0) {
      tags.push("\u5F71\u89C6\u8D44\u6E90");
    }
    return tags;
  }

  parseDate(dateStr: string): string {
    if (!dateStr) {
      return new Date().toISOString();
    }

    // Try YYYY-MM-DD
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    // Try YYYY年MM月DD日
    const match = dateStr.match(/(\d{4})\u5E74(\d{1,2})\u6708(\d{1,2})\u65E5/);
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]) - 1;
      const day = parseInt(match[3]);
      return new Date(year, month, day).toISOString();
    }

    return new Date().toISOString();
  }
}

export default JutoushePlugin;
