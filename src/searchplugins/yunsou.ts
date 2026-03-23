import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const SEARCH_URL_TEMPLATE = "https://yunsou.xyz/s/%s.html";
const JSON_DATA_REGEX = /var jsonData = '(.+?)';/;
const PWD_PARAM_REGEX = /[?&]pwd=([0-9a-zA-Z]+)/;
const CONTROL_CHARS_REGEX = /[\\x00-\\x1F\\x7F]/g;

interface YunsouItem {
  id: string;
  title?: string;
  times?: string;
  category?: {
    name?: string;
  };
  url?: string;
  is_type?: number;
  code?: string;
}

class Yunsou extends BasePlugin {
  constructor() {
    super("yunsou", 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 1. Build search URL
    const searchURL = SEARCH_URL_TEMPLATE.replace(
      "%s",
      encodeURIComponent(keyword),
    );

    // 2. Send request
    const resp = await fetchWithRetry(
      searchURL,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
          Referer: "https://yunsou.xyz/",
        },
      },
      { timeout: 30000, retries: 2 },
    );

    const htmlContent = await resp.text();

    // 3. Extract JSON data from HTML
    const jsonStr = this._extractJSONData(htmlContent);

    // 4. Parse JSON
    const items: YunsouItem[] = JSON.parse(jsonStr);

    // 5. Convert to standard format
    const results: SearchResult[] = [];
    for (const item of items) {
      const result = this._convertToSearchResult(item);
      if (result.uniqueId && result.links && result.links.length > 0) {
        results.push(result);
      }
    }

    // 6. Filter by keyword
    return filterByKeyword(results, keyword);
  }

  _extractJSONData(htmlContent: string): string {
    const matches = htmlContent.match(JSON_DATA_REGEX);
    if (!matches || matches.length < 2) {
      throw new Error("未找到JSON数据");
    }

    let jsonStr = matches[1];

    // Clean control characters
    jsonStr = jsonStr.replace(CONTROL_CHARS_REGEX, "");

    // Handle escaped slashes
    jsonStr = jsonStr.replace(/\\\//g, "/");

    return jsonStr;
  }

  _convertToSearchResult(item: YunsouItem): SearchResult {
    const result: SearchResult = {
      uniqueId: `${this.name}-${item.id}`,
      title: item.title || "",
      content: "",
      links: [],
      tags: [],
      datetime: "",
      channel: "",
    };

    // Parse time
    if (item.times) {
      const d = new Date(item.times);
      result.datetime = isNaN(d.getTime())
        ? new Date().toISOString()
        : d.toISOString();
    } else {
      result.datetime = new Date().toISOString();
    }

    // Build content description
    const contentParts: string[] = [];
    if (item.category && item.category.name) {
      contentParts.push("【" + item.category.name + "】");
    }
    result.content = contentParts.join(" ");

    // Add category tag
    if (item.category && item.category.name) {
      result.tags = [item.category.name];
    }

    // Build link
    if (item.url) {
      const link: Link = {
        type: this._convertNetDiskType(item.is_type),
        url: item.url,
        password: "",
      };

      // Handle password
      if (item.code != null && item.code !== "") {
        link.password = item.code;
      } else if (item.url.includes("?pwd=")) {
        link.password = this._extractPwdFromURL(item.url);
      }

      result.links = [link];
    }

    return result;
  }

  _convertNetDiskType(isType?: number): CloudType {
    switch (isType) {
      case 0:
        return "quark";
      case 1:
        return "aliyun";
      case 2:
        return "baidu";
      case 3:
        return "uc";
      case 4:
        return "xunlei";
      default:
        return "others";
    }
  }

  _extractPwdFromURL(urlStr: string): string {
    const matches = urlStr.match(PWD_PARAM_REGEX);
    return matches ? matches[1] : "";
  }
}

export default Yunsou;
