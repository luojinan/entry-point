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

const BASE_URL = "https://miaosou.fun/api/secendsearch";
const AES_KEY = "4OToScUFOaeVTrHE";
const AES_IV = "9CLGao1vHKqm17Oz";

// HTML tag cleaning regex
const htmlTagRegex = /<[^>]*>/g;

class MiaosoPlugin extends BasePlugin {
  constructor() {
    super("miaoso", 3);
  }

  /**
   * Search for resources
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Handle ext parameters
    let searchKeyword = keyword;
    if (
      ext &&
      ext.title_en &&
      typeof ext.title_en === "string" &&
      ext.title_en
    ) {
      searchKeyword = ext.title_en;
    }

    // Build request URL
    const searchURL = `${BASE_URL}?name=${encodeURIComponent(searchKeyword)}&pageNo=1`;

    // Send request
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          satoken: "503eb9c9-a07f-485c-a659-6c99facbb67f",
          Referer: `https://miaosou.fun/info?searchKey=${encodeURIComponent(searchKeyword)}`,
        },
      },
      { timeout: 30000, retries: 2 },
    );

    const body: any = await resp.json();

    // Check API response status
    if (body.code !== 200) {
      throw new Error(`[${this.name}] API error: ${body.msg}`);
    }

    // Convert to standard format
    const results: SearchResult[] = [];
    const list = (body.data && body.data.list) || [];

    for (const item of list) {
      const result = this._convertToSearchResult(item);
      if (result && result.links.length > 0) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Convert API item to search result
   */
  _convertToSearchResult(item: any): SearchResult | null {
    // Clean HTML tags from name
    const title = (item.name || "").replace(htmlTagRegex, "").trim();
    const content = item.content || "";

    // Parse datetime
    let datetime = "";
    if (item.gmtShare) {
      try {
        const d = new Date(item.gmtShare.replace(" ", "T") + "+08:00");
        if (!isNaN(d.getTime())) datetime = d.toISOString();
      } catch (e) {
        datetime = "";
      }
    }

    // Build links
    const links: Link[] = [];
    if (item.url) {
      const decryptedURL = this._decryptURL(item.url);
      if (decryptedURL) {
        links.push({
          type: this._determineCloudType(item.from),
          url: decryptedURL,
          password: "",
        });
      }
    }

    // Build tags
    const tags: string[] = [];
    if (item.from) tags.push(item.from);
    if (item.type) tags.push(item.type);

    return {
      uniqueId: `${this.name}-${item.id}`,
      title,
      content,
      links,
      datetime,
      tags,
      channel: "",
    };
  }

  /**
   * Decrypt URL using AES-128-CBC
   */
  _decryptURL(encryptedURL: string): string {
    if (!encryptedURL) return "";

    try {
      // Base64 decode
      const ciphertext = Buffer.from(encryptedURL, "base64");

      // Prepare key and IV
      const key = Buffer.from(AES_KEY, "utf8");
      const iv = Buffer.from(AES_IV, "utf8");

      // Check ciphertext length
      if (ciphertext.length < 16) return "";

      // AES-CBC decrypt
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
      decipher.setAutoPadding(true); // handles PKCS7 padding automatically

      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString("utf8");
    } catch (e) {
      return "";
    }
  }

  /**
   * Determine cloud type from platform identifier
   */
  _determineCloudType(from: string): CloudType {
    if (!from) return "others";
    switch (from.toLowerCase()) {
      case "quark":
        return "quark";
      case "baidu":
        return "baidu";
      case "uc":
        return "uc";
      case "ali":
        return "aliyun";
      case "xunlei":
        return "xunlei";
      case "tianyi":
        return "tianyi";
      case "115":
        return "115";
      case "123":
        return "123";
      default:
        return "others";
    }
  }
}

export default MiaosoPlugin;
