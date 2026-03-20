import cheerio from "cheerio";
import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

/**
 * alupan 插件 - aliupan.com 阿里云盘资源搜索
 * 搜索列表页 + 详情页抓取网盘链接
 */
class AlupanPlugin extends BasePlugin {
  private articleIDRegex: RegExp;
  private linkPatterns: Array<{ regex: RegExp; type: string }>;
  private pwdPatterns: RegExp[];

  constructor() {
    super("alupan", 2);
    this.articleIDRegex = /\?p=(\d+)/;
    this.linkPatterns = [
      { regex: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/, type: "quark" },
      {
        regex: /https?:\/\/www\.aliyundrive\.com\/s\/[0-9A-Za-z]+/,
        type: "aliyun",
      },
      {
        regex: /https?:\/\/www\.aliyundrive\.com\/drive\/folder\/[0-9A-Za-z]+/,
        type: "aliyun",
      },
    ];
    this.pwdPatterns = [
      /提取码[:：]?\s*([0-9A-Za-z]+)/,
      /密码[:：]?\s*([0-9A-Za-z]+)/,
      /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
      /code\s*[=:：]\s*([0-9A-Za-z]+)/,
    ];
  }

  async search(
    keyword: string,
    _ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `https://www.aliupan.com/?s=${encodeURIComponent(keyword)}`;

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
          Referer: "https://www.aliupan.com/",
        },
      },
      { timeout: 12000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const articleItems: Array<{
      title: string;
      detailURL: string;
      articleID: string;
      summary: string;
      tags: string[];
      publishTime: string;
    }> = [];

    $("article.excerpt").each((_, el) => {
      const titleSel = $(el).find("header h2 a");
      const title = titleSel.text().trim();
      const detailURL = titleSel.attr("href");
      if (!title || !detailURL) return;

      const articleID = this._extractArticleID(detailURL);
      if (!articleID) return;

      const category = $(el).find("header .label").first().text().trim();
      const tags = category ? [category] : [];

      const summary = $(el).find("p.note").text().trim();
      const timeText = $(el).find("p .icon-time").parent().text().trim();
      const publishTime = this._parsePublishTime(timeText);

      articleItems.push({
        title,
        detailURL,
        articleID,
        summary,
        tags,
        publishTime,
      });
    });

    // Fetch detail pages concurrently
    const detailPromises = articleItems.map((item) =>
      this._fetchDetailLinks(item.detailURL).catch(() => [] as Link[]),
    );
    const detailResults = await Promise.all(detailPromises);

    const results: SearchResult[] = [];
    for (let i = 0; i < articleItems.length; i++) {
      const links = detailResults[i];
      if (links.length === 0) continue;

      const item = articleItems[i];
      results.push({
        uniqueId: `${this.name}-${item.articleID}`,
        title: item.title,
        content: item.summary,
        links,
        tags: item.tags,
        channel: "",
        datetime: item.publishTime,
      });
    }

    return filterByKeyword(results, keyword);
  }

  private _extractArticleID(detailURL: string): string {
    const matches = this.articleIDRegex.exec(detailURL);
    return matches ? matches[1] : "";
  }

  private _parsePublishTime(value: string): string {
    value = (value || "").trim();
    if (!value) return "";

    // Extract content inside parentheses if present
    const parenIdx = value.indexOf("(");
    if (parenIdx >= 0 && value.endsWith(")")) {
      value = value.substring(parenIdx + 1, value.length - 1).trim();
    }

    return value; // Return as string; date parsing done upstream if needed
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
          Referer: detailURL,
        },
      },
      { timeout: 10000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const results: Link[] = [];
    const seen = new Set<string>();

    $(".article-content a[href]").each((_, node) => {
      const href = ($(node).attr("href") || "").trim();
      if (!href) return;

      const { type: linkType, normalized } = this._classifyLink(href);
      if (!linkType || seen.has(normalized)) return;
      seen.add(normalized);

      const password = this._extractPassword($, node);
      results.push({ type: linkType as CloudType, url: normalized, password });
    });

    return results;
  }

  private _classifyLink(raw: string): { type: string; normalized: string } {
    for (const pattern of this.linkPatterns) {
      const match = pattern.regex.exec(raw);
      if (match) {
        return { type: pattern.type, normalized: match[0] };
      }
    }
    return { type: "", normalized: "" };
  }

  private _extractPassword(
    $: cheerio.CheerioAPI,
    node: cheerio.Element,
  ): string {
    const candidates = [
      $(node).text(),
      $(node).attr("title") || "",
      $(node).parent().text(),
    ];

    const parentNext = $(node).parent().next();
    if (parentNext.length) candidates.push(parentNext.text());

    const next = $(node).next();
    if (next.length) candidates.push(next.text());

    for (const text of candidates) {
      const pwd = this._matchPassword(text);
      if (pwd) return pwd;
    }
    return "";
  }

  private _matchPassword(text: string): string {
    text = (text || "").trim();
    if (!text) return "";
    for (const pattern of this.pwdPatterns) {
      const matches = pattern.exec(text);
      if (matches) return matches[1].trim();
    }
    return "";
  }
}

export default AlupanPlugin;
