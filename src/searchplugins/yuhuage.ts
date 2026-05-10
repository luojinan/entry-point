import * as cheerio from "cheerio";

import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://www.iyuhuage.fun";
const SEARCH_PATH = "/search/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const MAX_CONCURRENCY = 5;

interface YuhuageSearchResult extends SearchResult {
  // same as SearchResult
}

class Yuhuage extends BasePlugin {
  constructor() {
    super("yuhuage", 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH}${encodeURIComponent(keyword)}-1-time.html`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
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

    const items: YuhuageSearchResult[] = [];
    const detailURLs: string[] = [];

    $(".search-item.detail-width").each((i: number, el: cheerio.Element) => {
      const s = $(el);
      const titleLink = s.find(".item-title h3 a");
      const title = this._cleanTitle(titleLink.text());
      const detailHref = titleLink.attr("href");

      if (!title || !detailHref) {
        return;
      }

      const detailURL = BASE_URL + detailHref;
      detailURLs.push(detailURL);

      // Extract basic info
      const createTime = (
        s.find('.item-bar span:contains("创建时间") b').text() || ""
      ).trim();
      const size = (s.find(".item-bar .cpill.blue-pill").text() || "").trim();
      const fileCount = (
        s.find(".item-bar .cpill.yellow-pill").text() || ""
      ).trim();
      const hot = (
        s.find('.item-bar span:contains("热度") b').text() || ""
      ).trim();
      const lastDownload = (
        s.find('.item-bar span:contains("最近下载") b').text() || ""
      ).trim();

      let content = `创建时间: ${createTime} | 大小: ${size} | 文件数: ${fileCount} | 热度: ${hot}`;
      if (lastDownload) {
        content += ` | 最近下载: ${lastDownload}`;
      }

      const hashId = this._extractHashFromURL(detailURL);

      items.push({
        uniqueId: `${this.name}-${hashId}`,
        title,
        content,
        links: [],
        tags: ["磁力链接"],
        datetime: this._parseDateTime(createTime),
        channel: "",
      });
    });

    // Fetch detail pages in parallel
    await this._fetchDetailsParallel(detailURLs, items);

    return filterByKeyword(items, keyword);
  }

  async _fetchDetailsParallel(
    detailURLs: string[],
    results: YuhuageSearchResult[],
  ): Promise<void> {
    if (detailURLs.length === 0) {
      return;
    }

    for (let i = 0; i < detailURLs.length; i += MAX_CONCURRENCY) {
      const batch = detailURLs.slice(i, i + MAX_CONCURRENCY);
      const batchPromises = batch.map((url, j) => {
        const idx = i + j;
        if (idx >= results.length) {
          return Promise.resolve();
        }
        return this._fetchDetailLinks(url)
          .then((links) => {
            if (links && links.length > 0) {
              results[idx].links = links;
            }
          })
          .catch(() => {
            /* ignore detail fetch errors */
          });
      });

      await Promise.allSettled(batchPromises);
    }
  }

  async _fetchDetailLinks(detailURL: string): Promise<Link[]> {
    const resp = await fetchWithRetry(
      detailURL,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Referer: BASE_URL + "/",
        },
      },
      { timeout: 15000, retries: 2 },
    );

    const html = await resp.text();
    return this._parseDetailLinks(html);
  }

  _parseDetailLinks(html: string): Link[] {
    const $ = cheerio.load(html);
    const links: Link[] = [];

    // Extract magnet links
    $("a.download[href^='magnet:']").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        links.push({ type: "others", url: href, password: "" });
      }
    });

    // Extract thunder links
    $("a.download[href^='thunder:']").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        links.push({ type: "others", url: href, password: "" });
      }
    });

    return links;
  }

  _extractHashFromURL(detailURL: string): string {
    const match = (detailURL || "").match(/\/hash\/(\d+)\.html/);
    return match ? match[1] : "";
  }

  _cleanTitle(title: string): string {
    title = (title || "").trim();
    title = title.replace(/<[^>]*>/g, "");
    title = title.replace(/\s+/g, " ");
    return title.trim();
  }

  _parseDateTime(timeStr: string): string {
    if (!timeStr) {
      return new Date().toISOString();
    }

    const formats = [
      // Try direct Date parsing
      timeStr,
    ];

    for (const fmt of formats) {
      const d = new Date(fmt);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    }

    return new Date().toISOString();
  }
}

export default Yuhuage;
