import * as cheerio from "cheerio";

import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { Link, SearchResult } from "./types";

const SITE_URL = "https://duanjugou.top";
const MAX_CONCURRENT = 15;

// Quark link regex
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z_-]+/g;
const PWD_REGEX = /提取码[:：]\s*([a-zA-Z0-9]{4})/;

/**
 * djgou - 短剧狗插件
 * 短剧资源搜索，从搜索结果页获取列表，再并发获取详情页提取夸克网盘链接
 */
class Djgou extends BasePlugin {
  constructor() {
    super("djgou", 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 1. Build search URL
    const searchURL = `${SITE_URL}/search.php?q=${encodeURIComponent(keyword)}&page=1`;

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

    // 3. Find list container
    const mainListSection = $("div.erx-list-box");
    if (mainListSection.length === 0) {
      return [];
    }

    // 4. Parse search result items
    interface SearchItem {
      uniqueId: string;
      title: string;
      datetime: string;
      tags: string[];
      channel: string;
      _detailURL: string;
    }

    const items: SearchItem[] = [];
    mainListSection.find("ul.erx-list li.item").each((i, el) => {
      const item = this._parseSearchItem($, el, keyword);
      if (item) {
        items.push(item);
      }
    });

    if (items.length === 0) {
      return [];
    }

    // 5. Fetch detail pages concurrently
    const enhancedResults = await this._enhanceWithDetails(items);

    // 6. Keyword filter
    return filterByKeyword(enhancedResults, keyword);
  }

  private _getHeaders(): Record<string, string> {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      Referer: SITE_URL,
    };
  }

  private _parseSearchItem(
    $: cheerio.CheerioAPI,
    el: cheerio.Element,
    keyword: string,
  ): {
    uniqueId: string;
    title: string;
    datetime: string;
    tags: string[];
    channel: string;
    _detailURL: string;
  } | null {
    const $el = $(el);

    // Extract title area
    const $aDiv = $el.find("div.a");
    if ($aDiv.length === 0) {
      return null;
    }

    // Extract link and title
    const $linkElem = $aDiv.find("a.main");
    if ($linkElem.length === 0) {
      return null;
    }

    const title = ($linkElem.text() || "").trim();
    let link = $linkElem.attr("href");
    if (!link) {
      return null;
    }

    // Handle relative paths
    if (!link.startsWith("http")) {
      link = link.startsWith("/") ? SITE_URL + link : SITE_URL + "/" + link;
    }

    // Extract time
    let timeText = "";
    const $iDiv = $el.find("div.i");
    if ($iDiv.length > 0) {
      const $timeSpan = $iDiv.find("span.time");
      if ($timeSpan.length > 0) {
        timeText = ($timeSpan.text() || "").trim();
      }
    }

    // Generate unique ID
    const itemID = link.replace(SITE_URL, "").replace(/^\/|\/$/g, "");
    const uniqueId = `djgou-${encodeURIComponent(itemID)}`;

    return {
      uniqueId,
      title,
      datetime: timeText || "",
      tags: ["短剧"],
      channel: "",
      _detailURL: link,
    };
  }

  private async _enhanceWithDetails(
    items: Array<{
      uniqueId: string;
      title: string;
      datetime: string;
      tags: string[];
      channel: string;
      _detailURL: string;
    }>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
      const batch = items.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const { links, content } = await this._fetchDetailPage(
            item._detailURL,
          );
          if (links.length > 0) {
            const { _detailURL, ...cleanItem } = item;
            return { ...cleanItem, links, content };
          }
          return null;
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

  private async _fetchDetailPage(
    detailURL: string,
  ): Promise<{ links: Link[]; content: string }> {
    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Referer: SITE_URL,
          },
        },
        { timeout: 6000, retries: 2 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      const mainContent = $("div.erx-wrap");
      if (mainContent.length === 0) {
        return { links: [], content: "" };
      }

      // Extract links from entire page HTML
      const links = this._extractLinksFromDoc($, html);

      // Extract content
      let content = (mainContent.text() || "").trim().replace(/\s+/g, " ");
      if (content.length > 300) {
        content = content.substring(0, 300) + "...";
      }

      return { links, content };
    } catch (err) {
      return { links: [], content: "" };
    }
  }

  private _extractLinksFromDoc(
    $: cheerio.CheerioAPI,
    htmlContent: string,
  ): Link[] {
    const links: Link[] = [];
    const linkMap = new Set<string>();

    // Extract password
    const pwdMatch = htmlContent.match(PWD_REGEX);
    const password = pwdMatch ? pwdMatch[1] : "";

    // Method 1: Regex extraction of quark links from HTML
    const quarkLinks = htmlContent.match(QUARK_LINK_REGEX) || [];
    for (const quarkURL of quarkLinks) {
      if (!linkMap.has(quarkURL)) {
        linkMap.add(quarkURL);
        links.push({ type: "quark", url: quarkURL, password });
      }
    }

    // Method 2: From <a> tags
    $("a").each((i, el) => {
      const href = $(el).attr("href");
      if (!href) {
        return;
      }
      if (href.includes("pan.quark.cn") && !linkMap.has(href)) {
        linkMap.add(href);
        links.push({ type: "quark", url: href, password });
      }
    });

    return links;
  }
}

export default Djgou;
