import cheerio from "cheerio";
import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, SearchResult } from "./types";

/**
 * cldi 插件 - 磁力搜索 (1122132.xyz)
 * 搜索磁力链接，支持多页并发
 */
class CldiPlugin extends BasePlugin {
  private maxPages: number;
  private adRegex: RegExp;
  private fileSizeRegex: RegExp;
  private categoryMap: Record<string, string>;

  constructor() {
    super("cldi", 3);
    this.maxPages = 5;
    this.adRegex = /【[^】]*】/g;
    this.fileSizeRegex =
      /^(.+?)&nbsp;<span class="lightColor">([^<]+)<\/span>$/;
    this.categoryMap = {
      影视: "影视",
      音乐: "音乐",
      图像: "图像",
      文档书籍: "文档",
      压缩文件: "压缩包",
      安装包: "软件",
      其他: "其他",
    };
  }

  async search(
    keyword: string,
    _ext: Record<string, unknown> = {},
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

    return filterByKeyword(allResults, keyword);
  }

  private async _searchPage(
    keyword: string,
    page: number,
  ): Promise<SearchResult[]> {
    const searchURL = `https://wvmzbxki.1122132.xyz/search-${encodeURIComponent(keyword)}-0-2-${page}.html`;

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
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: "https://wvmzbxki.1122132.xyz/",
        },
      },
      { timeout: 30000, retries: 3 },
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

    const titleSection = $(el).find(".title h3");

    // Extract category
    const category = titleSection.find("span").first().text().trim();
    if (category) {
      const cleaned = category.replace(/[[\]]/g, "");
      result.tags = [this.categoryMap[cleaned] || "其他"];
    }

    // Extract title
    const titleLink = titleSection.find("a");
    const title = titleLink.text().trim();
    result.title = this._cleanTitle(title);

    // Extract magnet link
    const sbar = $(el).find(".sbar");
    const magnetLink = sbar.find("a[href^='magnet:']").attr("href");
    if (magnetLink) {
      result.links = [
        { type: "magnet" as CloudType, url: magnetLink, password: "" },
      ];
    }

    // Extract add time
    sbar.find("span").each((i, span) => {
      const text = $(span).text();
      if (text.includes("添加时间:")) {
        const timeStr = $(span).find("b").text().trim();
        if (timeStr) {
          result.datetime = timeStr;
        }
      }
    });

    // Extract file list
    const fileList: string[] = [];
    $(el)
      .find(".slist ul li")
      .each((i, li) => {
        const liHTML = $(li).html() || "";
        const sizeMatch = this.fileSizeRegex.exec(liHTML);
        if (sizeMatch) {
          const fileName = sizeMatch[1].trim();
          const fileSize = sizeMatch[2].trim();
          if (fileName && fileSize) {
            fileList.push(`${fileName} (${fileSize})`);
          }
        } else {
          const text = $(li).text().trim();
          if (text) fileList.push(text);
        }
      });

    if (fileList.length > 0) {
      result.content = fileList.join("\n");
    }

    return result;
  }

  private _cleanTitle(title: string): string {
    let cleaned = title.replace(this.adRegex, "");
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return cleaned;
  }
}

export default CldiPlugin;
