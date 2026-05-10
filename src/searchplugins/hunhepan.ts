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
import type { Link, SearchResult } from "./types";

const PLUGIN_NAME = "hunhepan";
const HUNHEPAN_API = "https://hunhepan.com/open/search/disk";
const QKPANSO_API = "https://qkpanso.com/v1/search/disk";
const KUAKE_API = "https://kuake8.com/v1/search/disk";
const MISOSO_API = "https://www.misoso.cc/v1/search/disk";
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGES = 3;

interface DiskItem {
  disk_id?: string;
  disk_name?: string;
  disk_type?: string;
  disk_pass?: string;
  link?: string;
  files?: string;
  shared_time?: string;
}

interface ApiRequestBody {
  page: number;
  q: string;
  user: string;
  exact: boolean;
  format: string[];
  share_time: string;
  size: number;
  type: string;
  exclude_user: string[];
  adv_params: {
    wechat_pwd: string;
    platform: string;
  };
}

class HunhepanPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Parallel requests to four APIs
    const apiURLs = [HUNHEPAN_API, QKPANSO_API, KUAKE_API, MISOSO_API];

    const apiPromises = apiURLs.map((apiURL) =>
      this.searchAPI(apiURL, keyword).catch(() => []),
    );

    const apiResults = await Promise.all(apiPromises);

    // Collect all items
    let allItems: DiskItem[] = [];
    for (const items of apiResults) {
      allItems = allItems.concat(items);
    }

    if (allItems.length === 0) {
      return [];
    }

    // Deduplicate
    const uniqueItems = this.deduplicateItems(allItems);

    // Convert to standard format
    return this.convertResults(uniqueItems);
  }

  private async searchAPI(
    apiURL: string,
    keyword: string,
  ): Promise<DiskItem[]> {
    // Concurrently fetch multiple pages
    const pagePromises: Promise<DiskItem[]>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      pagePromises.push(this.fetchPage(apiURL, keyword, page));
    }

    const pageResults = await Promise.all(
      pagePromises.map((p) => p.catch(() => [])),
    );

    let allItems: DiskItem[] = [];
    for (const items of pageResults) {
      allItems = allItems.concat(items);
    }
    return allItems;
  }

  private async fetchPage(
    apiURL: string,
    keyword: string,
    pageNum: number,
  ): Promise<DiskItem[]> {
    const reqBody: ApiRequestBody = {
      page: pageNum,
      q: keyword,
      user: "",
      exact: false,
      format: [],
      share_time: "",
      size: DEFAULT_PAGE_SIZE,
      type: "",
      exclude_user: [],
      adv_params: {
        wechat_pwd: "",
        platform: "pc",
      },
    };

    // Determine referer based on API URL
    let referer = "";
    let origin = "";
    if (apiURL.includes("qkpanso.com")) {
      referer = "https://qkpanso.com/search";
    } else if (apiURL.includes("kuake8.com")) {
      referer = "https://kuake8.com/search";
    } else if (apiURL.includes("hunhepan.com")) {
      referer = "https://hunhepan.com/search";
    } else if (apiURL.includes("misoso.cc")) {
      referer = "https://www.misoso.cc/search";
      origin = "https://www.misoso.cc";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    if (referer) {
      headers["Referer"] = referer;
    }
    if (origin) {
      headers["Origin"] = origin;
    }

    const resp = await fetchWithTimeout(
      apiURL,
      {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
      },
      10000,
    );

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();

    if (data.code !== 200) {
      throw new Error(data.msg || "API error");
    }

    return data.data && data.data.list ? data.data.list : [];
  }

  private deduplicateItems(items: DiskItem[]): DiskItem[] {
    const uniqueMap = new Map<string, DiskItem>();

    for (const item of items) {
      // Clean title HTML tags
      const cleanedName = this.cleanTitle(item.disk_name || "");
      item.disk_name = cleanedName;

      // Create composite key
      let key: string;
      if (item.disk_id) {
        key = item.disk_id;
      } else if (item.link) {
        key = `${item.link}|${cleanedName}`;
      } else {
        key = `${cleanedName}|${item.disk_type || ""}`;
      }

      if (uniqueMap.has(key)) {
        const existing = uniqueMap.get(key)!;
        // Compare scores to keep the richer one
        const existingScore = (existing.files || "").length;
        let newScore = (item.files || "").length;

        if (!existing.disk_pass && item.disk_pass) {
          newScore += 5;
        }
        if (!existing.shared_time && item.shared_time) {
          newScore += 3;
        }

        if (newScore > existingScore) {
          uniqueMap.set(key, item);
        }
      } else {
        uniqueMap.set(key, item);
      }
    }

    return Array.from(uniqueMap.values());
  }

  private convertResults(items: DiskItem[]): SearchResult[] {
    const results: SearchResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.link) {
        continue;
      }

      const link: Link = {
        url: item.link,
        type: convertDiskType(item.disk_type || ""),
        password: item.disk_pass || "",
      };

      let uniqueId = `hunhepan-${item.disk_id || ""}`;
      if (!item.disk_id) {
        uniqueId = `hunhepan-${Date.now()}-${i}`;
      }

      let datetime = "";
      if (item.shared_time) {
        datetime = item.shared_time;
      }

      results.push({
        uniqueId,
        title: this.cleanTitle(item.disk_name || ""),
        content: item.files || "",
        datetime,
        links: [link],
        channel: "",
        tags: [],
      });
    }

    return results;
  }

  private cleanTitle(title: string): string {
    const replacements: Record<string, string> = {
      "<em>": "",
      "</em>": "",
      "<b>": "",
      "</b>": "",
      "<strong>": "",
      "</strong>": "",
      "<i>": "",
      "</i>": "",
    };

    let result = title;
    for (const [tag, replacement] of Object.entries(replacements)) {
      result = result.split(tag).join(replacement);
    }

    return result.trim();
  }
}

export default HunhepanPlugin;
