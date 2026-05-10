import * as cheerio from "cheerio";

import { BasePlugin, cleanHTML, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

/**
 * aikanzy 插件 - aikanzy.com 爱看资源搜索
 * 搜索列表页 + 详情页抓取网盘链接
 */
class AikanzyPlugin extends BasePlugin {
  private articleIDRegex: RegExp;
  private viewCountRegex: RegExp;
  private quarkLinkRegex: RegExp;
  private ucLinkRegex: RegExp;
  private baiduLinkRegex: RegExp;
  private xunleiLinkRegex: RegExp;

  constructor() {
    super("aikanzy", 3);
    this.articleIDRegex = /\/([a-z]+)\/(\d+)\.html/;
    this.viewCountRegex = /(\d+)\s*阅读/;

    // 网盘链接正则
    this.quarkLinkRegex = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/g;
    this.ucLinkRegex =
      /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/g;
    this.baiduLinkRegex = /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+/g;
    this.xunleiLinkRegex = /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+/g;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `https://www.aikanzy.com/search?word=${encodeURIComponent(keyword)}&molds=article`;

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
          Referer: "https://www.aikanzy.com/",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
        },
      },
      { timeout: 15000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Parse article list
    const articleItems: Array<{
      id: string;
      title: string;
      detailURL: string;
      category: string;
      publishDate: string;
      viewCount: number;
      summary: string;
    }> = [];

    $("article.post-list.contt.blockimg").each((i, el) => {
      const detailLink = $(el).find("a[href]").first();
      const detailURL = detailLink.attr("href");
      if (!detailURL) {
        return;
      }

      const articleID = this._extractArticleID(detailURL);
      if (!articleID) {
        return;
      }

      let title = $(el)
        .find("header.entry-header span.entry-title a")
        .text()
        .trim();
      title = cleanHTML(title); // remove <b> etc
      if (!title) {
        return;
      }

      const category = $(el).find("div.entry-meta > a").first().text().trim();
      const publishDate = $(el).find("time").first().text().trim();

      const metaText = $(el).find("div.entry-meta").text();
      const viewCount = this._extractViewCount(metaText);

      let summary = $(el).find("div.entry-summary.ss p").text().trim();
      summary = cleanHTML(summary);

      articleItems.push({
        id: articleID,
        title,
        detailURL,
        category,
        publishDate,
        viewCount,
        summary,
      });
    });

    if (articleItems.length === 0) {
      return [];
    }

    // Fetch detail pages concurrently
    const detailPromises = articleItems.map((item) =>
      this._fetchDetailPageLinks(item.detailURL).catch(() => [] as Link[]),
    );
    const detailResults = await Promise.all(detailPromises);

    const results: SearchResult[] = [];
    for (let i = 0; i < articleItems.length; i++) {
      const links = detailResults[i];
      if (links.length === 0) {
        continue;
      }

      const item = articleItems[i];

      // Assemble content
      const contentParts: string[] = [];
      if (item.summary) {
        contentParts.push(item.summary);
      }
      if (item.category) {
        contentParts.push(item.category);
      }
      if (item.publishDate) {
        contentParts.push(item.publishDate);
      }
      if (item.viewCount > 0) {
        contentParts.push(`${item.viewCount}阅读`);
      }
      const content = contentParts.join(" | ");

      const tags = item.category ? [item.category] : [];

      results.push({
        uniqueId: `aikanzy-${item.id}`,
        title: item.title,
        content,
        links,
        datetime: item.publishDate,
        tags,
        channel: "",
      });
    }

    return filterByKeyword(results, keyword);
  }

  private _extractArticleID(urlStr: string): string {
    const matches = this.articleIDRegex.exec(urlStr);
    return matches && matches[2] ? matches[2] : "";
  }

  private _extractViewCount(text: string): number {
    const matches = this.viewCountRegex.exec(text);
    return matches ? parseInt(matches[1], 10) : 0;
  }

  private async _fetchDetailPageLinks(detailURL: string): Promise<Link[]> {
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
          Referer: "https://www.aikanzy.com/",
          "Upgrade-Insecure-Requests": "1",
        },
      },
      { timeout: 8000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const links: Link[] = [];
    const foundURLs = new Set<string>();

    // Method 1: from <a> href attributes
    $(
      "a[href*='pan.quark.cn'], a[href*='drive.uc.cn'], a[href*='pan.baidu.com'], a[href*='pan.xunlei.com']",
    ).each((i, el) => {
      const href = $(el).attr("href");
      if (!href || foundURLs.has(href)) {
        return;
      }
      foundURLs.add(href);

      const linkType = this._determineLinkType(href);
      if (!linkType) {
        return;
      }

      links.push({
        type: linkType,
        url: href,
        password: this._extractPasswordFromURL(href),
      });
    });

    // Method 2: regex fallback from full HTML text
    if (links.length === 0) {
      const fullHTML = $.html();

      const regexes = [
        { regex: this.quarkLinkRegex, type: "quark" as CloudType },
        { regex: this.ucLinkRegex, type: "uc" as CloudType },
        { regex: this.baiduLinkRegex, type: "baidu" as CloudType },
        { regex: this.xunleiLinkRegex, type: "xunlei" as CloudType },
      ];

      for (const { regex, type } of regexes) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        match = regex.exec(fullHTML);
        while (match !== null) {
          const link = match[0];
          if (!foundURLs.has(link)) {
            foundURLs.add(link);
            links.push({
              type,
              url: link,
              password: this._extractPasswordFromURL(link),
            });
          }
          match = regex.exec(fullHTML);
        }
      }
    }

    return links;
  }

  private _determineLinkType(urlStr: string): CloudType | "" {
    const lower = urlStr.toLowerCase();
    if (lower.includes("pan.quark.cn")) {
      return "quark";
    }
    if (lower.includes("drive.uc.cn")) {
      return "uc";
    }
    if (lower.includes("pan.baidu.com")) {
      return "baidu";
    }
    if (lower.includes("pan.xunlei.com")) {
      return "xunlei";
    }
    return "";
  }

  private _extractPasswordFromURL(urlStr: string): string {
    const pwdRegex = /pwd=([^#&]{4})/;
    const matches = pwdRegex.exec(urlStr);
    return matches ? matches[1] : "";
  }
}

export default AikanzyPlugin;
