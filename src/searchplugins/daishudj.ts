import * as cheerio from "cheerio";

import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

/**
 * daishudj 插件 - 袋鼠短剧 (daishuduanju.com) 搜索
 * 搜索列表页 + 详情页抓取网盘链接
 */
class DaishudjPlugin extends BasePlugin {
  private idRegex: RegExp;
  private textURLReg: RegExp;
  private linkPatterns: Array<{ regex: RegExp; type: string }>;
  private passwordPatterns: RegExp[];

  constructor() {
    super("daishudj", 3);
    this.idRegex = /\/(\d+)\//;
    this.textURLReg = /https?:\/\/[^\s<>"']+/g;

    this.linkPatterns = [
      {
        regex: /https?:\/\/pan\.quark\.cn\/(s|g)\/[0-9A-Za-z]+/,
        type: "quark",
      },
      {
        regex:
          /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/,
        type: "aliyun",
      },
      {
        regex: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_]+/,
        type: "baidu",
      },
      {
        regex: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_]+/,
        type: "xunlei",
      },
      { regex: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, type: "uc" },
      {
        regex: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/,
        type: "pikpak",
      },
      { regex: /https?:\/\/caiyun\.139\.com\/[^\s]+/, type: "mobile" },
      { regex: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, type: "magnet" },
      {
        regex:
          /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/,
        type: "123",
      },
    ];

    this.passwordPatterns = [
      /提取码[:：]?\s*([0-9A-Za-z]+)/,
      /密码[:：]?\s*([0-9A-Za-z]+)/,
      /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
      /code\s*[=:：]\s*([0-9A-Za-z]+)/,
    ];
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `https://www.daishuduanju.com/?s=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: "https://www.daishuduanju.com/",
        },
      },
      { timeout: 30000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    interface ArticleItem {
      title: string;
      detailURL: string;
      postID: string;
      summary: string;
      tags: string[];
      publishTime: string;
    }

    const articleItems: ArticleItem[] = [];
    $(".item-jx.item-blog").each((_, el) => {
      const titleSel = $(el).find(".subtitle h5 a");
      const title = titleSel.text().trim();
      const detailURL = titleSel.attr("href");
      if (!title || !detailURL) {
        return;
      }

      const postID = this._extractPostID(detailURL);
      if (!postID) {
        return;
      }

      const summary = $(el).find(".subtitle p.pdesc").text().trim();

      const tags: string[] = [];
      const cat = $(el).find(".sortbox a.sort").text().trim();
      if (cat) {
        tags.push(cat);
      }

      const dateText = $(el).find(".pmbox .time").text().trim();
      const publishTime = this._parseChineseDate(dateText);

      articleItems.push({
        title,
        detailURL,
        postID,
        summary,
        tags,
        publishTime,
      });
    });

    // Fetch detail pages concurrently
    const detailPromises = articleItems.map((item) =>
      this._fetchDetailLinks(item.detailURL).catch(() => []),
    );
    const detailResults = await Promise.all(detailPromises);

    const results: SearchResult[] = [];
    for (let i = 0; i < articleItems.length; i++) {
      const links = detailResults[i];
      if (links.length === 0) {
        continue;
      }

      const item = articleItems[i];
      results.push({
        uniqueId: `${this.name}-${item.postID}`,
        title: item.title,
        content: item.summary,
        links,
        tags: item.tags,
        channel: "",
        datetime: item.publishTime,
      });
    }

    if (results.length === 0) {
      return [];
    }

    return filterByKeyword(results, keyword);
  }

  private _extractPostID(detailURL: string): string {
    const matches = this.idRegex.exec(detailURL);
    return matches ? matches[1] : "";
  }

  private _parseChineseDate(value: string): string {
    value = (value || "").trim();
    if (!value) {
      return "";
    }
    value = value.replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "");
    return value;
  }

  private async _fetchDetailLinks(detailURL: string): Promise<Link[]> {
    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: "https://www.daishuduanju.com/",
        },
      },
      { timeout: 25000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Try different containers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let container: any = $(".article-body");
    if (container.length === 0) {
      container = $("article.post");
    }
    if (container.length === 0) {
      container = $.root();
    }

    return this._extractLinks($, container);
  }

  private _extractLinks(
    $: cheerio.CheerioAPI,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selection: any,
  ): Link[] {
    const results: Link[] = [];
    const seen = new Set<string>();

    // Method 1: from <a> href attributes
    selection.find("a[href]").each((_: unknown, node: cheerio.Element) => {
      const href = ($(node).attr("href") || "").trim();
      if (!href) {
        return;
      }

      const { type: linkType, normalized } = this._classifyLink(href);
      if (!linkType || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);

      const password = this._extractPasswordFromNode($, node);
      results.push({ type: linkType as CloudType, url: normalized, password });
    });

    // Method 2: regex from text content
    const text = selection.text();
    this.textURLReg.lastIndex = 0;
    let match: RegExpExecArray | null = this.textURLReg.exec(text);
    while (match !== null) {
      const raw = match[0];
      const { type: linkType, normalized } = this._classifyLink(raw);
      if (!linkType || seen.has(normalized)) {
        match = this.textURLReg.exec(text);
        continue;
      }
      seen.add(normalized);

      // Get context around the URL for password extraction
      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + raw.length + 80);
      const context = text.substring(start, end);
      const password = this._matchPassword(context);

      results.push({ type: linkType as CloudType, url: normalized, password });
      match = this.textURLReg.exec(text);
    }

    return results;
  }

  private _classifyLink(raw: string): { type: CloudType; normalized: string } {
    for (const pattern of this.linkPatterns) {
      const match = pattern.regex.exec(raw);
      if (match) {
        return { type: pattern.type as CloudType, normalized: match[0] };
      }
    }
    return { type: "others" as CloudType, normalized: "" };
  }

  private _extractPasswordFromNode(
    $: cheerio.CheerioAPI,
    node: cheerio.Element,
  ): string {
    const candidates = [$(node).text(), $(node).attr("title") || ""];

    const parent = $(node).parent();
    if (parent.length) {
      candidates.push(parent.text());
      const parentNext = parent.next();
      if (parentNext.length) {
        candidates.push(parentNext.text());
      }
    }

    const sibling = $(node).next();
    if (sibling.length) {
      candidates.push(sibling.text());
    }

    for (const text of candidates) {
      const pwd = this._matchPassword(text);
      if (pwd) {
        return pwd;
      }
    }
    return "";
  }

  private _matchPassword(text: string): string {
    text = (text || "").trim();
    if (!text) {
      return "";
    }
    for (const pattern of this.passwordPatterns) {
      const matches = pattern.exec(text);
      if (matches) {
        return matches[1].trim();
      }
    }
    return "";
  }
}

export default DaishudjPlugin;
