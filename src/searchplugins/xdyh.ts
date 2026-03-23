import {
  BasePlugin,
  determineCloudType,
  fetchWithRetry,
  filterByKeyword,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "xdyh";
const API_URL = "https://ys.66ds.de/search";
const REFERER_URL = "https://ys.66ds.de/";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  "Content-Type": "application/json",
  Referer: REFERER_URL,
  Origin: "https://ys.66ds.de",
  "Cache-Control": "max-age=0",
};

const TAG_KEYWORDS: Record<string, string> = {
  "4k": "4K",
  "1080p": "1080P",
  "720p": "720P",
  蓝光: "蓝光",
  高清: "高清",
  更新: "更新中",
  完结: "完结",
  电影: "电影",
  剧集: "剧集",
  动漫: "动漫",
  综艺: "综艺",
};

interface APIItem {
  title?: string;
  source_site?: string;
  drive_links?: string[];
  password?: string;
  post_date?: string;
  link_count?: number;
  has_password?: boolean;
  file_preview?: string;
}

interface APIResponse {
  status: string;
  data?: APIItem[];
}

export default class XdyhPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const requestBody = {
      keyword,
      sites: null,
      max_workers: 10,
      save_to_file: false,
      split_links: true,
    };

    const resp = await fetchWithRetry(
      API_URL,
      {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(requestBody),
      },
      { timeout: 15000, retries: 3 },
    );

    const apiResp: APIResponse = await resp.json();

    if (apiResp.status !== "success") {
      throw new Error(`API returned error status: ${apiResp.status}`);
    }

    const results = this.convertToSearchResults(apiResp, keyword);

    return filterByKeyword(results, keyword);
  }

  private convertToSearchResults(
    apiResp: APIResponse,
    keyword: string,
  ): SearchResult[] {
    const results: SearchResult[] = [];
    const seenTitles = new Set<string>();
    const data = apiResp.data || [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i];

      const titleKey = `${item.title}_${item.source_site}`;
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      const links = this.convertDriveLinks(item);
      if (links.length === 0) continue;

      const datetime = this.parseDateTime(item.post_date);

      const content = this.buildContentDescription(item);

      const tags = this.extractTags(item.title, item.source_site);

      results.push({
        uniqueId: `${PLUGIN_NAME}-${i}`,
        title: item.title || "",
        content,
        links,
        datetime,
        tags,
        channel: "",
      });
    }

    return results;
  }

  private convertDriveLinks(item: APIItem): Link[] {
    const links: Link[] = [];
    const driveLinks = item.drive_links || [];

    for (const driveURL of driveLinks) {
      if (!driveURL || !this.isValidURL(driveURL)) continue;

      const linkType = determineCloudType(driveURL);

      links.push({
        type: linkType,
        url: driveURL,
        password: item.password || "",
      });
    }

    return links;
  }

  private parseDateTime(dateStr?: string): string {
    if (!dateStr) return new Date().toISOString();

    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return new Date().toISOString();
  }

  private buildContentDescription(item: APIItem): string {
    const parts: string[] = [];

    if (item.source_site) parts.push(`来源: ${item.source_site}`);
    if (item.link_count && item.link_count > 0)
      parts.push(`链接数: ${item.link_count}`);
    if (item.has_password && item.password)
      parts.push(`密码: ${item.password}`);

    if (item.file_preview) {
      let preview = item.file_preview
        .replace(/<em>/g, "")
        .replace(/<\/em>/g, "");
      if (preview.length > 100) preview = preview.substring(0, 100) + "...";
      parts.push(`预览: ${preview}`);
    }

    return parts.join(" | ");
  }

  private extractTags(title?: string, sourceSite?: string): string[] {
    const tags: string[] = [];

    if (sourceSite) tags.push(sourceSite);

    const lowerTitle = (title || "").toLowerCase();
    for (const [keyword, tag] of Object.entries(TAG_KEYWORDS)) {
      if (lowerTitle.includes(keyword)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  private isValidURL(urlStr: string): boolean {
    if (!urlStr) return false;
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      if (urlStr.length <= 8 || urlStr === "http://" || urlStr === "https://")
        return false;
      return urlStr.substring(8).includes(".");
    }
    return false;
  }
}
