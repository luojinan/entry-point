/**
 * haisou - 海搜插件
 * 搜索多种网盘类型（ali, baidu, quark, xunlei, tianyi），
 * 第一阶段并发搜索获取 hsid，第二阶段并发获取链接
 */

import { BasePlugin, cleanHTML, fetchWithRetry, filterByKeyword } from "./base";
import type { Link, SearchResult } from "./types";

const SUPPORTED_CLOUD_TYPES = ["ali", "baidu", "quark", "xunlei", "tianyi"];
const DEFAULT_PAGES_PER_TYPE = 2;
const MAX_ALLOWED_PAGES_PER_TYPE = 3;

interface ShareItem {
  hsid: string;
  share_name: string;
  platform: string;
  stat_file?: number;
  stat_size?: number;
}

interface LinkResult {
  hsid: string;
  shareURL: string;
  password: string;
  item: ShareItem;
}

class Haisou extends BasePlugin {
  constructor() {
    super("haisou", 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Get pages per type config
    let pagesPerType = DEFAULT_PAGES_PER_TYPE;
    if (
      ext.pages_per_type &&
      typeof ext.pages_per_type === "number" &&
      ext.pages_per_type > 0
    ) {
      pagesPerType = Math.min(ext.pages_per_type, MAX_ALLOWED_PAGES_PER_TYPE);
    }

    // Phase 1: Concurrent search to get all hsids
    const searchTasks: Promise<ShareItem[]>[] = [];
    for (const cloudType of SUPPORTED_CLOUD_TYPES) {
      for (let pageNo = 1; pageNo <= pagesPerType; pageNo++) {
        searchTasks.push(this._fetchSearchPage(keyword, pageNo, cloudType));
      }
    }

    const searchResults = await Promise.allSettled(searchTasks);

    // Collect all share items
    const allShareItems: ShareItem[] = [];
    let successTasks = 0;

    for (const result of searchResults) {
      if (result.status === "fulfilled" && result.value) {
        allShareItems.push(...result.value);
        successTasks++;
      }
    }

    if (successTasks === 0) {
      throw new Error("[haisou] All search tasks failed");
    }

    // Phase 2: Concurrent fetch of all links
    const linkTasks = allShareItems.map((item) =>
      this._fetchShareLink(item.hsid, item.platform)
        .then(({ shareURL, password }) => ({
          hsid: item.hsid,
          shareURL,
          password,
          item,
        }))
        .catch(() => null),
    );

    const linkResults = await Promise.allSettled(linkTasks);

    // Build hsid to link mapping
    const hsidToLink: Record<string, LinkResult> = {};
    for (const result of linkResults) {
      if (result.status === "fulfilled" && result.value) {
        hsidToLink[result.value.hsid] = result.value;
      }
    }

    // Phase 3: Combine results
    const results: SearchResult[] = [];
    for (const shareItem of allShareItems) {
      const linkResult = hsidToLink[shareItem.hsid];
      if (!linkResult) continue;

      // Clean HTML tags from title
      const title = this._cleanHTMLTags(shareItem.share_name) || "未知资源";

      const link: Link = {
        type: this._mapPlatformType(shareItem.platform),
        url: linkResult.shareURL,
        password: linkResult.password,
      };

      results.push({
        uniqueId: `haisou-${shareItem.hsid}`,
        title,
        content: `文件数量: ${shareItem.stat_file || 0} | 网盘类型: ${shareItem.platform} | 大小: ${this._formatSize(shareItem.stat_size || 0)}`,
        links: [link],
        tags: [shareItem.platform],
        channel: "",
        datetime: new Date().toISOString(),
      });
    }

    // Keyword filter
    return filterByKeyword(results, keyword);
  }

  private async _fetchSearchPage(
    keyword: string,
    pageNo: number,
    panType: string,
  ): Promise<ShareItem[]> {
    const searchURL = `https://haisou.cc/api/pan/share/search?query=${encodeURIComponent(keyword)}&scope=title&pan=${panType}&page=${pageNo}&filter_valid=true&filter_has_files=false`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: "https://haisou.cc/",
        },
      },
      { timeout: 30000, retries: 3 },
    );

    const data = await resp.json();

    if (data.code !== 0) {
      throw new Error(`API error: ${data.msg}`);
    }

    return (data.data && data.data.list) || [];
  }

  private async _fetchShareLink(
    hsid: string,
    platform: string,
  ): Promise<{ shareURL: string; password: string }> {
    const fetchURL = `https://haisou.cc/api/pan/share/${hsid}/fetch`;

    const resp = await fetchWithRetry(
      fetchURL,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Referer: "https://haisou.cc/",
        },
      },
      { timeout: 15000, retries: 3 },
    );

    const data = await resp.json();

    if (data.code !== 0) {
      throw new Error(`API error: ${data.msg}`);
    }

    const shareCode = data.data && data.data.share_code;
    if (!shareCode) {
      throw new Error("No share code in response");
    }

    const shareURL = this._buildShareURL(platform, shareCode);
    if (!shareURL) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    const password = (data.data && data.data.share_pwd) || "";

    return { shareURL, password };
  }

  private _buildShareURL(platform: string, shareCode: string): string {
    switch ((platform || "").toLowerCase()) {
      case "ali":
        return `https://www.alipan.com/s/${shareCode}`;
      case "baidu":
        return `https://pan.baidu.com/s/${shareCode}`;
      case "quark":
        return `https://pan.quark.cn/s/${shareCode}`;
      case "xunlei":
        return `https://pan.xunlei.com/s/${shareCode}`;
      case "tianyi":
        return `https://cloud.189.cn/t/${shareCode}`;
      default:
        return "";
    }
  }

  private _mapPlatformType(platform: string): string {
    switch ((platform || "").toLowerCase()) {
      case "ali":
        return "aliyun";
      case "baidu":
        return "baidu";
      case "quark":
        return "quark";
      case "xunlei":
        return "xunlei";
      case "tianyi":
        return "tianyi";
      default:
        return "others";
    }
  }

  private _cleanHTMLTags(text: string): string {
    if (!text) return "";
    // Remove highlight span tags
    text = text.replace(
      /<span[^>]*class="highlight"[^>]*>(.*?)<\/span>/g,
      "$1",
    );
    // Remove other HTML tags
    text = text.replace(/<[^>]*>/g, "");
    return text.trim();
  }

  private _formatSize(size: number): string {
    const KB = 1024;
    const MB = 1024 * KB;
    const GB = 1024 * MB;
    const TB = 1024 * GB;

    if (size >= TB) return `${(size / TB).toFixed(2)} TB`;
    if (size >= GB) return `${(size / GB).toFixed(2)} GB`;
    if (size >= MB) return `${(size / MB).toFixed(2)} MB`;
    if (size >= KB) return `${(size / KB).toFixed(2)} KB`;
    return `${size} B`;
  }
}

export default Haisou;
