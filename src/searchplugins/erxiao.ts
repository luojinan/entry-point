import cheerio from "cheerio";
import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { Link, SearchResult } from "./types";

const BASE_URL = "https://erxiaofn.click";
const MAX_CONCURRENT = 20;

// Link type detection regexes
const LINK_REGEXES: Record<string, RegExp> = {
  quark: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/,
  uc: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/,
  baidu: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(\?pwd=[0-9a-zA-Z]+)?/,
  aliyun: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/,
  xunlei: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(\?pwd=[0-9a-zA-Z]+)?/,
  tianyi: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/,
  "115": /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/,
  mobile: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/,
  "123": /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/,
  pikpak: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/,
  magnet: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/,
  ed2k: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//,
};

const DETAIL_ID_REGEX = /\/id\/(\d+)/;
const PASSWORD_REGEX = /\?pwd=([0-9a-zA-Z]+)/;

/**
 * erxiao - 二小放映厅插件
 * 影视资源搜索，从搜索结果页获取列表，再并发获取详情页提取网盘下载链接
 */
class Erxiao extends BasePlugin {
  constructor() {
    super("erxiao", 1);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 1. Build search URL
    const searchURL = `${BASE_URL}/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;

    // 2. Fetch search page
    const resp = await fetchWithRetry(
      searchURL,
      {
        method: "GET",
        headers: this._getHeaders(),
      },
      { timeout: 8000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Parse search results
    interface SearchItem {
      uniqueId: string;
      title: string;
      content: string;
      links: Link[];
      tags: string[];
      channel: string;
      datetime: string;
      _itemID: string;
    }

    const items: SearchItem[] = [];
    $(".module-search-item").each((i, el) => {
      const item = this._parseSearchItem($, el);
      if (item) items.push(item);
    });

    if (items.length === 0) return [];

    // 4. Fetch detail pages concurrently
    const enhancedResults = await this._enhanceWithDetails(items);

    // 5. Keyword filter
    return filterByKeyword(enhancedResults, keyword);
  }

  private _getHeaders(): Record<string, string> {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      Referer: BASE_URL + "/",
    };
  }

  private _parseSearchItem(
    $: cheerio.CheerioAPI,
    el: cheerio.Element,
  ): {
    uniqueId: string;
    title: string;
    content: string;
    links: Link[];
    tags: string[];
    channel: string;
    datetime: string;
    _itemID: string;
  } | null {
    const $el = $(el);

    // Extract detail link and ID
    const $titleLink = $el.find(".video-info-header h3 a").first();
    const detailLink = $titleLink.attr("href");
    if (!detailLink) return null;

    const matches = detailLink.match(DETAIL_ID_REGEX);
    if (!matches || matches.length < 2) return null;
    const itemID = matches[1];

    // Extract title
    const title = ($titleLink.text() || "").trim();
    if (!title) return null;

    // Extract category
    const category = (
      $el
        .find(".video-info-items")
        .first()
        .find(".video-info-item")
        .first()
        .text() || ""
    ).trim();

    // Extract director
    let director = "";
    $el.find(".video-info-items").each((i, item) => {
      const itemTitle = (
        $(item).find(".video-info-itemtitle").text() || ""
      ).trim();
      if (itemTitle.includes("导演")) {
        director = ($(item).find(".video-info-item").text() || "").trim();
      }
    });

    // Extract actors
    let actor = "";
    $el.find(".video-info-items").each((i, item) => {
      const itemTitle = (
        $(item).find(".video-info-itemtitle").text() || ""
      ).trim();
      if (itemTitle.includes("主演")) {
        actor = ($(item).find(".video-info-item").text() || "").trim();
      }
    });

    // Extract year
    const year = (
      $el
        .find(".video-info-items")
        .last()
        .find(".video-info-item")
        .first()
        .text() || ""
    ).trim();

    // Extract quality
    const quality = (
      $el.find(".video-info-header .video-info-remarks").text() || ""
    ).trim();

    // Extract plot
    let plot = "";
    $el.find(".video-info-items").each((i, item) => {
      const itemTitle = (
        $(item).find(".video-info-itemtitle").text() || ""
      ).trim();
      if (itemTitle.includes("剧情")) {
        plot = ($(item).find(".video-info-item").text() || "").trim();
      }
    });

    // Build content
    const contentParts: string[] = [];
    if (quality) contentParts.push("【" + quality + "】");
    if (director) contentParts.push("导演：" + director);
    if (actor) contentParts.push("主演：" + actor);
    if (year) contentParts.push("年份：" + year);
    if (plot) contentParts.push("剧情：" + plot);

    // Build tags
    const tags: string[] = [];
    if (year) tags.push(year);
    if (category) tags.push(category);

    return {
      uniqueId: `erxiao-${itemID}`,
      title,
      content: contentParts.join("\n"),
      links: [],
      tags,
      channel: "",
      datetime: "",
      _itemID: itemID,
    };
  }

  private async _enhanceWithDetails(
    items: Array<{
      uniqueId: string;
      title: string;
      content: string;
      links: Link[];
      tags: string[];
      channel: string;
      datetime: string;
      _itemID: string;
    }>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
      const batch = items.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const links = await this._fetchDetailLinks(item._itemID);
          const { _itemID, ...cleanItem } = item;
          return { ...cleanItem, links };
        }),
      );

      for (const res of batchResults) {
        if (res.status === "fulfilled" && res.value) {
          results.push(res.value);
        }
      }
    }

    return results;
  }

  private async _fetchDetailLinks(itemID: string): Promise<Link[]> {
    try {
      const detailURL = `${BASE_URL}/index.php/vod/detail/id/${itemID}.html`;

      const resp = await fetchWithRetry(
        detailURL,
        {
          method: "GET",
          headers: this._getHeaders(),
        },
        { timeout: 6000, retries: 2 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      const links: Link[] = [];
      const seen = new Set<string>();

      // Find download links area
      $("#download-list .module-row-one").each((i, el) => {
        // From data-clipboard-text attribute
        const clipboardText = $(el)
          .find("[data-clipboard-text]")
          .attr("data-clipboard-text");
        if (clipboardText && this._isValidURL(clipboardText)) {
          const linkType = this._determineLinkType(clipboardText);
          if (linkType && !seen.has(clipboardText)) {
            seen.add(clipboardText);
            links.push({
              type: linkType as any,
              url: clipboardText,
              password: "",
            });
          }
        }
      });

      return links;
    } catch (err) {
      return [];
    }
  }

  private _isValidURL(url: string): boolean {
    if (!url) return false;
    if (url.includes("javascript:") || url.includes("#") || url === "")
      return false;
    if (
      !url.startsWith("http") &&
      !url.startsWith("magnet:") &&
      !url.startsWith("ed2k:")
    )
      return false;
    return true;
  }

  private _determineLinkType(url: string): string {
    for (const [type, regex] of Object.entries(LINK_REGEXES)) {
      if (regex.test(url)) return type;
    }
    return "";
  }
}

export default Erxiao;
