/**
 * susu 插件 - SuSu网站搜索 (susuifa.com)
 * 翻译自 Go 插件: plugin/susu/susu.go
 */

import * as cheerio from 'cheerio';
import { BasePlugin, fetchWithRetry, getRandomUA } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const SEARCH_URL = "https://susuifa.com/?type=post&s=%s";
const BUTTON_DETAIL_URL =
  "https://susuifa.com/wp-json/b2/v1/getDownloadPageData?post_id=%s&index=0&i=%d&guest=";
const BUTTON_COUNT = 6;

interface ButtonDetail {
  type: CloudType | "others";
  url: string;
  password: string;
}

interface JWTPayload {
  data?: {
    url?: string;
  };
}

interface ButtonData {
  button?: {
    url?: string;
    name?: string;
  };
}

export default class SusuPlugin extends BasePlugin {
  constructor() {
    super("susu", 1);
  }

  private _extractPostID($: cheerio.CheerioAPI, s: cheerio.Element): string {
    const itemID = $(s).attr("id");
    if (itemID && itemID.startsWith("item-")) {
      return itemID.replace("item-", "");
    }

    const href = $(s).find(".post-info h2 a").attr("href");
    if (href) {
      const m = href.match(/\/(\d+)\.html/);
      if (m) return m[1];
    }

    return "";
  }

  private _decodeJWTURL(jwtToken: string): string {
    const parts = jwtToken.split(".");
    if (parts.length !== 3) throw new Error("无效的JWT格式");

    let payload = parts[1];
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";

    const decoded = Buffer.from(payload, "base64").toString("utf8");
    const data: JWTPayload = JSON.parse(decoded);
    return data.data?.url || "";
  }

  private _determineLinkType(url: string, name: string): CloudType | "others" {
    const lowerURL = (url || "").toLowerCase();
    const lowerName = (name || "").toLowerCase();

    if (lowerURL.includes("pan.baidu.com")) return "baidu";
    if (lowerURL.includes("alipan.com") || lowerURL.includes("aliyundrive.com"))
      return "aliyun";
    if (lowerURL.includes("pan.xunlei.com")) return "xunlei";
    if (lowerURL.includes("pan.quark.cn")) return "quark";
    if (lowerURL.includes("cloud.189.cn")) return "tianyi";
    if (lowerURL.includes("115.com")) return "115";
    if (lowerURL.includes("drive.uc.cn")) return "uc";
    if (lowerURL.includes("caiyun.139.com")) return "mobile";
    if (lowerURL.includes("123pan.com")) return "123";
    if (lowerURL.includes("mypikpak.com")) return "pikpak";

    if (lowerName.includes("百度")) return "baidu";
    if (lowerName.includes("阿里")) return "aliyun";
    if (lowerName.includes("迅雷")) return "xunlei";
    if (lowerName.includes("夸克")) return "quark";
    if (lowerName.includes("天翼")) return "tianyi";
    if (lowerName.includes("115")) return "115";
    if (lowerName.includes("uc")) return "uc";
    if (lowerName.includes("移动") || lowerName.includes("彩云"))
      return "mobile";
    if (lowerName.includes("123")) return "123";
    if (lowerName.includes("pikpak")) return "pikpak";

    return "others";
  }

  private async _getButtonDetail(
    postID: string,
    index: number,
  ): Promise<ButtonDetail | null> {
    const buttonDetailURL = BUTTON_DETAIL_URL.replace("%s", postID).replace(
      "%d",
      index.toString(),
    );

    try {
      const resp = await fetchWithRetry(
        buttonDetailURL,
        {
          method: "POST",
          headers: {
            "User-Agent": getRandomUA(),
            "Content-Type": "application/json",
            Referer: `https://susuifa.com/download?post_id=${postID}&index=0&i=${index}`,
          },
        },
        { timeout: 30000, retries: 0 },
      );

      const data: ButtonData = await resp.json();

      if (!data.button?.url) return null;

      const realURL = this._decodeJWTURL(data.button.url);
      if (!realURL) return null;

      return {
        type: this._determineLinkType(realURL, data.button.name || ""),
        url: realURL,
        password: "",
      };
    } catch (e) {
      return null;
    }
  }

  private async _getLinks(postID: string): Promise<Link[]> {
    const promises: Promise<ButtonDetail | null>[] = [];
    for (let i = 0; i < BUTTON_COUNT; i++) {
      promises.push(this._getButtonDetail(postID, i));
    }

    const results = await Promise.all(promises);
    return results.filter(
      (link): link is ButtonDetail => link !== null && link.url !== "",
    );
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = SEARCH_URL.replace("%s", encodeURIComponent(keyword));

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent": getRandomUA(),
          Referer: "https://susuifa.com/",
        },
      },
      { timeout: 30000, retries: 0 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const items: cheerio.Element[] = [];

    $(".post-list-item").each((i, s) => {
      const title = $(s).find(".post-info h2 a").text().trim();
      const lowerTitle = title.toLowerCase();

      const matched = keywords.every((kw) => lowerTitle.includes(kw));
      if (matched) items.push(s);
    });

    const resultPromises = items.map(
      async (s): Promise<SearchResult | null> => {
        const postID = this._extractPostID($, s);
        if (!postID) return null;

        const title = $(s).find(".post-info h2 a").text().trim();
        const content = $(s).find(".post-excerpt").text().trim();

        const datetimeStr =
          $(s).find(".list-footer time.b2timeago").attr("datetime") || "";
        const datetime = datetimeStr || "";

        const tags: string[] = [];
        $(s)
          .find(".post-list-cat-item")
          .each((i, t) => {
            const tag = $(t).text().trim();
            if (tag) tags.push(tag);
          });

        let links: Link[] = [];
        try {
          links = await this._getLinks(postID);
        } catch (e) {
          // 获取链接失败，继续
        }

        return {
          uniqueId: `susu-${postID}`,
          title,
          content,
          datetime,
          links,
          tags,
          channel: "",
        };
      },
    );

    const allResults = await Promise.all(resultPromises);

    return allResults.filter((r): r is SearchResult => r !== null);
  }
}
