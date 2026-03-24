import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

/**
 * cyg 插件 - cyg.app WordPress REST API搜索
 * 搜索帖子列表 + 获取每个帖子的下载链接API
 */
class CygPlugin extends BasePlugin {
  private htmlTagRegex: RegExp;
  private urlPatterns: Array<{ regex: RegExp; type: string }>;
  private nameMap: Record<string, string>;

  constructor() {
    super("cyg", 3);
    this.htmlTagRegex = /<[^>]*>/g;

    // URL-based cloud type regexes
    this.urlPatterns = [
      { regex: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/, type: "quark" },
      { regex: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+/, type: "uc" },
      { regex: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+/, type: "baidu" },
      {
        regex:
          /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/,
        type: "aliyun",
      },
      {
        regex: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+/,
        type: "xunlei",
      },
      { regex: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/, type: "tianyi" },
      { regex: /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/, type: "115" },
      {
        regex:
          /https?:\/\/(caiyun\.feixin\.10086\.cn|caiyun\.139\.com|yun\.139\.com|cloud\.139\.com|pan\.139\.com)\/.*/,
        type: "mobile",
      },
      { regex: /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/, type: "123" },
      { regex: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/, type: "pikpak" },
      { regex: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/, type: "magnet" },
      { regex: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//, type: "ed2k" },
    ];

    // Name-based cloud type mapping
    this.nameMap = {
      夸克: "quark",
      夸克网盘: "quark",
      uc: "uc",
      uc网盘: "uc",
      百度网盘: "baidu",
      百度: "baidu",
      baidu: "baidu",
      阿里云盘: "aliyun",
      阿里: "aliyun",
      aliyun: "aliyun",
      阿里网盘: "aliyun",
      迅雷: "xunlei",
      迅雷网盘: "xunlei",
      xunlei: "xunlei",
      天翼: "tianyi",
      天翼云盘: "tianyi",
      "189": "tianyi",
      "189云盘": "tianyi",
      "115": "115",
      "115网盘": "115",
      移动云盘: "mobile",
      移动: "mobile",
      mobile: "mobile",
      和彩云: "mobile",
      "139云盘": "mobile",
      "139": "mobile",
      中国移动云盘: "mobile",
      "123网盘": "123",
      "123pan": "123",
      "123": "123",
      pikpak: "pikpak",
      pikpak网盘: "pikpak",
      磁力链接: "magnet",
      magnet: "magnet",
      ed2k: "ed2k",
    };
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Parse options
    const perPage = (ext && (ext.per_page as number)) || 20;
    const page = (ext && (ext.page as number)) || 1;
    const orderBy = (ext && (ext.order_by as string)) || "date";
    const order = (ext && (ext.order as string)) || "desc";

    // Build search URL
    const searchURL = `https://cyg.app/wp-json/wp/v2/posts?per_page=${perPage}&orderby=${orderBy}&order=${order}&page=${page}&search=${encodeURIComponent(keyword)}`;

    // Fetch search results
    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          Referer: "https://h5.acgn.my/",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
        },
      },
      { timeout: 30000, retries: 3 },
    );

    const posts = (await resp.json()) as Array<{
      id: number;
      title?: { rendered?: string };
      excerpt?: { rendered?: string };
      date?: string;
      category_name?: string;
    }>;
    if (!posts || posts.length === 0) return [];

    // Fetch download links concurrently for each post
    const linkPromises = posts.map((post) =>
      this._getDownloadLinks(post.id).catch(() => []),
    );
    const linkResults = await Promise.all(linkPromises);

    const results: SearchResult[] = [];
    for (let i = 0; i < posts.length; i++) {
      const links = linkResults[i];
      if (links.length === 0) continue;

      const post = posts[i];
      results.push({
        uniqueId: `cyg-${post.id}`,
        title: this._cleanHTML(post.title?.rendered || ""),
        content: this._cleanHTML(post.excerpt?.rendered || ""),
        datetime: post.date || "",
        tags: post.category_name ? [post.category_name] : [],
        links,
        channel: "",
      });
    }

    return filterByKeyword(results, keyword);
  }

  private async _getDownloadLinks(postID: number): Promise<Link[]> {
    const downloadURL = `https://cyg.app/wp-json/acg-studio/v1/download?id=${postID}`;

    const resp = await fetchWithRetry(
      downloadURL,
      {
        headers: {
          Referer: "https://h5.acgn.my/",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
        },
      },
      { timeout: 30000, retries: 3 },
    );

    const downloadData = await resp.json();
    if (!downloadData || !Array.isArray(downloadData)) return [];

    return downloadData.map(
      (item: { url?: string; name?: string; downloadPwd?: string }) => {
        // Determine link type: URL match first, then name match
        let linkType = this._determineCloudTypeByURL(item.url || "");
        if (linkType === "others") {
          linkType = this._determineCloudTypeByName(item.name || "");
        }

        return {
          type: linkType,
          url: item.url || "",
          password: item.downloadPwd || "",
        };
      },
    );
  }

  private _determineCloudTypeByURL(url: string): CloudType {
    for (const { regex, type } of this.urlPatterns) {
      if (regex.test(url)) return type as CloudType;
    }
    return "others";
  }

  private _determineCloudTypeByName(name: string): CloudType {
    const key = name.toLowerCase().trim();
    return (this.nameMap[key] || "others") as CloudType;
  }

  private _cleanHTML(htmlContent: string): string {
    // Remove HTML tags
    let text = htmlContent.replace(this.htmlTagRegex, "");
    // Decode HTML entities
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
    // Clean extra whitespace
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }
}

export default CygPlugin;
