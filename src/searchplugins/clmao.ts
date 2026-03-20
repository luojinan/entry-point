import cheerio from "cheerio";
import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, SearchResult } from "./types";

/**
 * clmao 插件 - 磁力猫 (8800492.xyz)
 * 磁力链接搜索引擎，支持多页并发
 */
class ClmaoPlugin extends BasePlugin {
  private baseURL: string;
  private maxPages: number;
  private maxRetries: number;
  private ua: string;
  private categoryMap: Record<string, string>;

  constructor() {
    super("clmao", 3);
    this.baseURL = "https://www.8800492.xyz";
    this.maxPages = 5;
    this.maxRetries = 3;
    this.ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

    this.categoryMap = {
      "[影视]": "video",
      "[音乐]": "music",
      "[图像]": "image",
      "[文档书籍]": "document",
      "[压缩文件]": "archive",
      "[安装包]": "software",
      "[其他]": "others",
    };
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Fetch first page
    let firstPageResults: SearchResult[];
    try {
      firstPageResults = await this._searchPage(keyword, 1);
    } catch (e) {
      throw new Error(
        `[${this.name}] search page 1 failed: ${(e as Error).message}`,
      );
    }

    let allResults = [...firstPageResults];

    // Fetch pages 2-5 concurrently
    if (this.maxPages > 1) {
      const pagePromises: Array<Promise<SearchResult[]>> = [];
      for (let page = 2; page <= this.maxPages; page++) {
        pagePromises.push(
          this._searchPage(keyword, page).catch(() => [] as SearchResult[]),
        );
      }
      const pageResults = await Promise.all(pagePromises);
      for (const results of pageResults) {
        allResults = allResults.concat(results);
      }
    }

    // Use ext search keyword if provided
    let searchKeyword = keyword;
    if (
      ext &&
      ext.search &&
      typeof ext.search === "string" &&
      ext.search !== ""
    ) {
      searchKeyword = ext.search;
    }

    return filterByKeyword(allResults, searchKeyword);
  }

  private async _searchPage(
    keyword: string,
    page: number,
  ): Promise<SearchResult[]> {
    const searchURL = `${this.baseURL}/search-${encodeURIComponent(keyword)}-0-2-${page}.html`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent": this.ua,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      },
      { timeout: 30000, retries: this.maxRetries },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this._extractSearchResults($);
  }

  private _extractSearchResults($: cheerio.CheerioAPI): SearchResult[] {
    const results: SearchResult[] = [];

    $(".tbox .ssbox").each((i, el) => {
      const result = this._parseSearchResult($, el);
      if (result.title && result.links.length > 0) {
        results.push(result);
      }
    });

    return results;
  }

  private _parseSearchResult(
    $: cheerio.CheerioAPI,
    el: cheerio.Element,
  ): SearchResult {
    const result: SearchResult = {
      uniqueId: `${this.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: "",
      content: "",
      links: [],
      datetime: new Date().toISOString(),
      tags: [],
      channel: "",
    };

    // Extract title
    const titleSection = $(el).find(".title h3");
    const titleLink = titleSection.find("a");
    const title = titleLink.text().trim();
    result.title = this._cleanTitle(title);

    // Extract category as tag
    const category = titleSection.find("span").text().trim();
    if (category) {
      result.tags = [this.categoryMap[category] || "others"];
    }

    // Extract magnet link and metadata
    const sbar = $(el).find(".sbar");
    const magnetLink = sbar.find("a[href^='magnet:']").attr("href");
    if (magnetLink) {
      result.links = [
        { type: "magnet" as CloudType, url: magnetLink, password: "" },
      ];
    }

    // Extract metadata
    const metadata: string[] = [];
    sbar.find("span").each((i, span) => {
      const text = $(span).text().trim();
      if (
        text.includes("添加时间:") ||
        text.includes("大小:") ||
        text.includes("热度:")
      ) {
        metadata.push(text);
      }
    });

    if (metadata.length > 0) {
      result.content = metadata.join(" | ");
    }

    // Extract file list
    const files: string[] = [];
    $(el)
      .find(".slist ul li")
      .each((i, li) => {
        const text = $(li).text().trim();
        if (text) files.push(text);
      });

    if (files.length > 0) {
      if (result.content) {
        result.content += "\n\n文件列表:\n";
      } else {
        result.content = "文件列表:\n";
      }
      result.content += files.join("\n");
    }

    return result;
  }

  private _cleanTitle(title: string): string {
    // Remove content in Chinese brackets
    title = title.replace(/【[^】]*】/g, "");
    // Remove content in square brackets
    title = title.replace(/\[[^\]]*\]/g, "");
    // Remove extra spaces
    title = title.replace(/\s+/g, " ").trim();
    return title;
  }
}

export default ClmaoPlugin;
