import * as cheerio from "cheerio";

import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://www.zxzjhd.com";
const SEARCH_PATH = "/vodsearch/-------------.html";
const MAX_RESULTS = 10;
const MAX_CONCURRENT = 5;

interface SearchItem {
  id: string;
  title: string;
  detailURL: string;
}

interface PlayLink {
  url: string;
  label: string;
  lineType: string;
}

interface PlayerData {
  panURL: string;
  password: string;
}

class Zxzj extends BasePlugin {
  constructor() {
    super("zxzj", 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?wd=${encodeURIComponent(keyword)}&submit=`;

    // Step 1: Fetch search results
    const items = await this._fetchSearchResults(searchURL);
    if (items.length === 0) {
      return [];
    }

    const limited = items.slice(0, MAX_RESULTS);

    // Step 2: Process detail pages
    const results = await this._processDetailPages(limited);

    return filterByKeyword(results, keyword);
  }

  async _fetchSearchResults(searchURL: string): Promise<SearchItem[]> {
    const resp = await fetchWithRetry(
      searchURL,
      {
        method: "GET",
        headers: this._headers(BASE_URL),
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const items: SearchItem[] = [];
    $("ul.stui-vodlist li").each((_, el) => {
      const link = $(el).find(".stui-vodlist__detail h4.title a");
      const href = link.attr("href");
      if (!href) {
        return;
      }

      const title = (link.text() || "").trim();
      if (!title) {
        return;
      }

      const match = href.match(/\/detail\/(\d+)\.html/);
      if (!match) {
        return;
      }

      items.push({
        id: match[1],
        title,
        detailURL: this._buildAbsURL(href),
      });
    });

    return items;
  }

  async _processDetailPages(items: SearchItem[]): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
      const batch = items.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map((item) => this._processDetailPage(item)),
      );

      for (const res of batchResults) {
        if (res.status === "fulfilled" && res.value) {
          results.push(res.value);
        }
      }
    }

    return results;
  }

  async _processDetailPage(item: SearchItem): Promise<SearchResult | null> {
    const resp = await fetchWithRetry(
      item.detailURL,
      {
        method: "GET",
        headers: this._headers(BASE_URL),
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    let title = ($(".stui-content__detail h1.title").text() || "").trim();
    if (!title) {
      title = item.title;
    }

    // Extract description and update time
    let description = "";
    let updateTime: Date | null = null;
    $(".stui-content__detail p.data").each((_, el) => {
      const text = ($(el).text() || "").trim();
      if (text) {
        if (description) {
          description += "\n";
        }
        description += text;

        if (!updateTime && text.includes("更新")) {
          updateTime = this._parseUpdateTime(text);
        }
      }
    });

    if (!updateTime) {
      updateTime = new Date();
    }

    // Extract play links
    const playLinks = this._extractPlayLinks($);
    if (playLinks.length === 0) {
      return null;
    }

    // Fetch pan links from play pages
    const links = await this._fetchPanLinks(playLinks);
    if (links.length === 0) {
      return null;
    }

    return {
      uniqueId: `${this.name}-${item.id}`,
      title,
      content: description,
      links,
      datetime: updateTime.toISOString(),
      tags: [],
      channel: "",
    };
  }

  _extractPlayLinks($: cheerio.CheerioAPI): PlayLink[] {
    const links: PlayLink[] = [];

    $(".stui-vodlist__head").each((_, el) => {
      const head = $(el);
      const lineTitle = (head.find("h3").text() || "").trim();
      if (!lineTitle) {
        return;
      }

      const panType = this._detectPanType(lineTitle);
      if (!panType) {
        return;
      }

      // Find the next playlist ul
      let playlist = head.next();
      while (playlist.length > 0 && !playlist.is("ul.stui-content__playlist")) {
        playlist = playlist.next();
      }

      if (playlist.length === 0) {
        return;
      }

      playlist.find("li a").each((_, a) => {
        const href = $(a).attr("href");
        if (!href) {
          return;
        }

        const label = ($(a).text() || "").trim();
        links.push({
          url: this._buildAbsURL(href),
          label,
          lineType: panType,
        });
      });
    });

    return links;
  }

  _detectPanType(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes("百度")) {
      return "baidu";
    }
    if (lower.includes("夸克")) {
      return "quark";
    }
    if (lower.includes("迅雷")) {
      return "xunlei";
    }
    return "";
  }

  async _fetchPanLinks(playLinks: PlayLink[]): Promise<Link[]> {
    const links: Link[] = [];

    for (let i = 0; i < playLinks.length; i += MAX_CONCURRENT) {
      const batch = playLinks.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map((pl) => this._fetchSinglePanLink(pl)),
      );

      for (const res of batchResults) {
        if (res.status === "fulfilled" && res.value) {
          links.push(res.value);
        }
      }
    }

    return links;
  }

  async _fetchSinglePanLink(pl: PlayLink): Promise<Link | null> {
    try {
      const resp = await fetchWithRetry(
        pl.url,
        {
          method: "GET",
          headers: this._headers(BASE_URL),
        },
        { timeout: 30000, retries: 2 },
      );

      const body = await resp.text();

      const { panURL, password } = this._parsePlayerData(body);
      if (!panURL) {
        return null;
      }

      const cloudType = this._determinePanType(panURL, pl.lineType);
      if (!cloudType) {
        return null;
      }

      return {
        type: cloudType,
        url: panURL,
        password,
      };
    } catch (e) {
      return null;
    }
  }

  _parsePlayerData(body: string): PlayerData {
    const match = body.match(/var\s+player_aaaa\s*=\s*(\{[^;]+\})/);
    if (!match) {
      return { panURL: "", password: "" };
    }

    try {
      const data = JSON.parse(match[1]) as { url?: string };
      let panURL = (data.url || "").trim();
      if (!panURL) {
        return { panURL: "", password: "" };
      }

      panURL = panURL.replace(/\\\//g, "/");
      const password = this._extractPassword(panURL);

      return { panURL, password };
    } catch (e) {
      return { panURL: "", password: "" };
    }
  }

  _extractPassword(panURL: string): string {
    try {
      const u = new URL(panURL);
      const pwd = u.searchParams.get("pwd");
      if (pwd && pwd.length === 4) {
        return pwd;
      }
    } catch (e) {
      // not a valid URL, try other methods
    }

    if (panURL.includes("|")) {
      const parts = panURL.split("|");
      if (parts.length >= 2) {
        const pwd = parts[1].trim();
        if (pwd.length === 4) {
          return pwd;
        }
      }
    }

    const pwdMatch = panURL.match(/pwd=([a-zA-Z0-9]{4})/);
    if (pwdMatch) {
      return pwdMatch[1];
    }

    return "";
  }

  _determinePanType(panURL: string, lineType: string): CloudType {
    const lower = panURL.toLowerCase();

    if (lower.includes("pan.baidu.com")) {
      return "baidu";
    }
    if (lower.includes("pan.quark.cn")) {
      return "quark";
    }
    if (lower.includes("pan.xunlei.com")) {
      return "xunlei";
    }
    if (lower.includes("aliyundrive.com") || lower.includes("alipan.com")) {
      return "aliyun";
    }

    if (lineType) {
      return lineType as CloudType;
    }

    return "others";
  }

  _buildAbsURL(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    if (path.startsWith("//")) {
      return "https:" + path;
    }
    if (!path.startsWith("/")) {
      path = "/" + path;
    }
    return BASE_URL + path;
  }

  _headers(referer: string): Record<string, string> {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      Referer: referer,
    };
  }

  _parseUpdateTime(text: string): Date | null {
    const match = text.match(
      /更新[：:]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2})/,
    );
    if (!match) {
      return null;
    }

    const d = new Date(match[1].trim());
    return isNaN(d.getTime()) ? null : d;
  }
}

export default Zxzj;
