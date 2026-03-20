import crypto from "crypto";
import {
  BasePlugin,
  cleanHTML,
  convertDiskType,
  deduplicateResults,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  fetchWithTimeout,
  filterByKeyword,
  generateUniqueID,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const API_URL = "https://nsthwj.com/thwj/game/query";
const PAGE_SIZE = 1000;

const urlRegex = /https?:\/\/[^\s]+/;
const baiduLinkRegex = /https:\/\/pan\.baidu\.com\/s\/[^?\s]+/;
const baiduPwdRegex = /\?pwd=([a-zA-Z0-9]+)/;

interface APIResponse {
  success: boolean;
  code: string;
  data?: {
    pageData?: {
      data?: APIItem[];
    };
  };
}

interface APIItem {
  name?: string;
  url?: string;
  password?: string;
}

interface BaiduLinkResult {
  url: string;
  password: string;
}

class NsgamePlugin extends BasePlugin {
  constructor() {
    super("nsgame", 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 1. Build search URL
    const searchURL = `${API_URL}?pageNum=1&pageSize=${PAGE_SIZE}&type=&queryName=${encodeURIComponent(keyword)}`;

    // 2. Send request
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://nsthwj.com/",
        },
      },
      { timeout: 10000, retries: 2 },
    );

    const body: APIResponse = await resp.json();

    // 3. Check response status
    if (!body.success || body.code !== "200") {
      throw new Error(
        `[${this.name}] API error: success=${body.success}, code=${body.code}`,
      );
    }

    // 4. Convert to standard format
    const results: SearchResult[] = [];
    const items: APIItem[] =
      (body.data && body.data.pageData && body.data.pageData.data) || [];

    for (const item of items) {
      // Parse network drive links
      const links = this._parseLinks(item.url || "");
      if (links.length === 0) continue;

      // Generate unique ID
      const uniqueId = this._generateUniqueID(item.name || "");

      // Build title with version info
      let title = item.name || "";
      if (item.password) {
        const versionInfo = item.password.replace(/\n/g, " ");
        title = `${item.name}（${versionInfo}）`;
      }

      results.push({
        uniqueId,
        title,
        content: item.password || "",
        links,
        datetime: new Date().toISOString(),
        tags: ["NS游戏", "Switch"],
        channel: "",
      });
    }

    // 5. Filter by keyword
    return filterByKeyword(results, keyword);
  }

  _parseLinks(urlText: string): Link[] {
    const links: Link[] = [];
    const lines = urlText.split("\n");

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.includes("[夸克网盘]")) {
        // Quark format: [夸克网盘]：https://pan.quark.cn/s/xxx
        const url = this._extractURL(line);
        if (url && url.includes("pan.quark.cn")) {
          links.push({ type: "quark" as CloudType, url, password: "" });
        }
      } else if (line.includes("[UC网盘]")) {
        // UC format: [UC网盘]：https://drive.uc.cn/s/xxx
        const url = this._extractURL(line);
        if (url && url.includes("drive.uc.cn")) {
          links.push({ type: "uc" as CloudType, url, password: "" });
        }
      } else if (line.includes("pan.baidu.com")) {
        // Baidu format: https://pan.baidu.com/s/xxx?pwd=xxxx
        const { url, password } = this._extractBaiduLink(line);
        if (url) {
          links.push({ type: "baidu" as CloudType, url, password });
        }
      }
    }

    return links;
  }

  _extractURL(text: string): string {
    const match = urlRegex.exec(text);
    return match ? match[0].trim() : "";
  }

  _extractBaiduLink(line: string): BaiduLinkResult {
    const fullURL = this._extractURL(line);
    if (!fullURL) return { url: "", password: "" };

    const linkMatch = baiduLinkRegex.exec(fullURL);
    if (!linkMatch) return { url: "", password: "" };

    const url = linkMatch[0];
    let password = "";

    const pwdMatch = baiduPwdRegex.exec(fullURL);
    if (pwdMatch && pwdMatch.length >= 2) {
      password = pwdMatch[1];
    }

    return { url, password };
  }

  _generateUniqueID(gameName: string): string {
    const hash = crypto.createHash("md5").update(gameName).digest("hex");
    return `${this.name}-${hash}`.substring(0, 28);
  }
}

export default NsgamePlugin;
