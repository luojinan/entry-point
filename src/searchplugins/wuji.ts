import * as cheerio from "cheerio";

import {
  BasePlugin,
  fetchWithRetry,
  filterByKeyword,
  generateUniqueID,
} from "./base";
import type { Link, SearchResult } from "./types";

const PLUGIN_NAME = "wuji";
const BASE_URL = "https://xcili.net";
const MAX_PAGES = 5;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

interface SearchResultWithDetail extends SearchResult {
  _detailURL?: string;
}

export default class WujiPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const pagePromises: Promise<SearchResultWithDetail[]>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      pagePromises.push(
        this.searchPage(keyword, page).catch(
          () => [] as SearchResultWithDetail[],
        ),
      );
    }

    const pageResults = await Promise.all(pagePromises);
    const allResults: SearchResultWithDetail[] = [];
    for (const results of pageResults) {
      allResults.push(...results);
    }

    const finalResults = await this.enrichWithMagnetLinks(allResults);

    const searchKeyword = (ext && (ext.search as string)) || keyword;
    return filterByKeyword(finalResults, searchKeyword);
  }

  private async searchPage(
    keyword: string,
    page: number,
  ): Promise<SearchResultWithDetail[]> {
    const searchURL = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}&page=${page}`;

    const resp = await fetchWithRetry(
      searchURL,
      { headers: HEADERS },
      { timeout: 30000, retries: 3 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.extractSearchResults($);
  }

  private extractSearchResults(
    $: cheerio.CheerioAPI,
  ): SearchResultWithDetail[] {
    const results: SearchResultWithDetail[] = [];

    $("table.file-list tbody tr").each((i, el) => {
      const s = $(el);
      const result = this.parseSearchResult($, s);
      if (result && result.title) {
        results.push(result);
      }
    });

    return results;
  }

  private parseSearchResult(
    $: cheerio.CheerioAPI,
    s: cheerio.Cheerio<cheerio.Element>,
  ): SearchResultWithDetail | null {
    const titleCell = s.find("td").first();
    const titleLink = titleCell.find("a");

    const detailPath = titleLink.attr("href");
    if (!detailPath) {
      return null;
    }

    const detailURL = BASE_URL + detailPath;

    const titleClone = titleLink.clone();
    titleClone.find("p.sample").remove();
    let title = titleClone.text().trim();
    title = this.cleanTitle(title);

    const sampleText = titleLink.find("p.sample").text().trim();

    const sizeText = s.find("td.td-size").text().trim();

    const contentParts: string[] = [];
    if (sampleText) {
      contentParts.push("文件: " + sampleText);
    }
    if (sizeText) {
      contentParts.push("大小: " + sizeText);
    }
    const content = contentParts.join("\n");

    return {
      uniqueId: generateUniqueID(PLUGIN_NAME, detailURL, String(Date.now())),
      title,
      content,
      links: [{ type: "others", url: detailURL, password: "" }],
      datetime: new Date().toISOString(),
      tags: ["magnet"],
      channel: "",
      _detailURL: detailURL,
    };
  }

  private cleanTitle(title: string): string {
    title = title.replace(/【[^】]*】/g, "");
    title = title.replace(/^\d+【[^】]*】/g, "");
    title = title.replace(/\[[^\]]*\]/g, "");
    title = title.replace(/\s+/g, " ");
    return title.trim();
  }

  private async enrichWithMagnetLinks(
    results: SearchResultWithDetail[],
  ): Promise<SearchResult[]> {
    if (results.length === 0) {
      return results;
    }

    const tasks = results.map(
      async (result, index): Promise<SearchResult | null> => {
        if (!result._detailURL) {
          return null;
        }

        try {
          await new Promise((r) => setTimeout(r, (index % 5) * 100));

          const magnetLink = await this.fetchMagnetLink(result._detailURL);
          if (magnetLink) {
            const { _detailURL, ...cleanResult } = result;
            cleanResult.links = [
              { type: "magnet", url: magnetLink, password: "" },
            ];
            return cleanResult;
          }
        } catch (e) {
          // skip
        }
        return null;
      },
    );

    const settled = await Promise.all(tasks);
    return settled.filter((r): r is SearchResult => r !== null);
  }

  private async fetchMagnetLink(detailURL: string): Promise<string | null> {
    const resp = await fetchWithRetry(
      detailURL,
      { headers: HEADERS },
      { timeout: 30000, retries: 3 },
    );
    const html = await resp.text();
    const $ = cheerio.load(html);

    const magnetInput = $("input#input-magnet");
    if (magnetInput.length === 0) {
      return null;
    }

    const magnetLink = magnetInput.attr("value");
    return magnetLink || null;
  }
}
