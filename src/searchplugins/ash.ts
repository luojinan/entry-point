import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, SearchResult } from "./types";

/**
 * ash 插件 - allsharehub.com 搜索
 * 从搜索页面HTML中提取内嵌JSON数据
 */
class AshPlugin extends BasePlugin {
  private jsonDataRegex: RegExp;
  private wrongQuarkDomain: string;
  private correctQuarkDomain: string;

  constructor() {
    super("ash", 2);
    this.jsonDataRegex = /var jsonData = '(\[.*?\])';/;
    this.wrongQuarkDomain = "pan.qualk.cn";
    this.correctQuarkDomain = "pan.quark.cn";
  }

  async search(
    keyword: string,
    _ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `https://so.allsharehub.com/s/${encodeURIComponent(keyword)}.html`;

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
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
          Referer: "https://so.allsharehub.com/",
        },
      },
      { timeout: 15000, retries: 2 },
    );

    const html = await resp.text();

    // Extract JSON data from HTML
    const matches = this.jsonDataRegex.exec(html);
    if (!matches || !matches[1]) return [];

    let jsonStr = matches[1];

    // Clean JSON string
    if (jsonStr.includes("\\/")) {
      jsonStr = jsonStr.replace(/\\\//g, "/");
    }
    // Remove control characters
    jsonStr = jsonStr
      .split("")
      .filter((c) => {
        const code = c.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      })
      .join("");

    let ashResults: Array<Record<string, unknown>>;
    try {
      ashResults = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`JSON parse failed: ${(e as Error).message}`);
    }

    if (!ashResults || ashResults.length === 0) return [];

    const results: SearchResult[] = [];
    const categoryNames = [
      "短剧",
      "电影",
      "电视剧",
      "动漫",
      "综艺",
      "充电视频",
    ];

    for (const item of ashResults) {
      if (!item.url) continue;

      // Fix pan URL
      const panURL = this._fixPanURL(item.url as string);
      if (!panURL) continue;

      // Determine pan type by is_type field
      let panType: CloudType;
      switch (item.is_type) {
        case 0:
          panType = "quark";
          break;
        case 2:
          panType = "baidu";
          break;
        case 3:
          panType = "uc";
          break;
        case 4:
          panType = "xunlei";
          break;
        default:
          panType = "quark";
          break;
      }

      // Extract password
      let password = "";
      if (item.code && typeof item.code === "string" && item.code !== "") {
        password = item.code;
      }

      // Parse datetime
      let datetime = "";
      if (item.times && typeof item.times === "string") {
        datetime = item.times;
      }

      // Get tags from category ID
      const tags: string[] = [];
      const catId = item.source_category_id as number;
      if (catId > 0 && catId <= 6) {
        tags.push(categoryNames[catId - 1]);
      }

      results.push({
        uniqueId: `${this.name}-${item.id}`,
        title: (item.title as string) || "",
        content: (item.name as string) || "",
        datetime,
        channel: "",
        links: [{ type: panType, url: panURL, password }],
        tags,
      });
    }

    return filterByKeyword(results, keyword);
  }

  private _fixPanURL(url: string): string {
    if (!url || url.length < 8) return "";
    if (!url.startsWith("http")) return "";

    if (url.includes(this.wrongQuarkDomain)) {
      return url.replace(this.wrongQuarkDomain, this.correctQuarkDomain);
    }

    return url;
  }
}

export default AshPlugin;
