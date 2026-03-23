/**
 * sousou 插件 - Sousou搜索 (sousou.pro)
 * 翻译自 Go 插件: plugin/sousou/sousou.go
 */

import {
  BasePlugin,
  deduplicateResults,
  fetchWithRetry,
  filterByKeyword,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const SOUSOU_API = "https://sousou.pro/api.php";
const DEFAULT_PER_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;

// 支持的网盘类型列表
const SUPPORTED_DISK_TYPES = ["QUARK", "BDY", "ALY", "XUNLEI", "UC", "115"];

interface SousouItem {
  disk_id?: string;
  disk_name?: string;
  disk_type?: string;
  link?: string;
  disk_pass?: string;
  files?: string;
  shared_time?: string;
  tags?: string[] | string;
}

interface SousouApiResponse {
  code: number;
  data?: {
    list?: SousouItem[];
  };
}

class SousouPlugin extends BasePlugin {
  constructor() {
    super("sousou", 3);
  }

  /**
   * 将API的网盘类型转换为标准链接类型
   */
  private _convertDiskType(diskType: string): CloudType {
    const map: Record<string, CloudType> = {
      BDY: "baidu",
      ALY: "aliyun",
      QUARK: "quark",
      TIANYI: "tianyi",
      UC: "uc",
      CAIYUN: "mobile",
      "115": "115",
      XUNLEI: "xunlei",
      "123PAN": "123",
      PIKPAK: "pikpak",
    };
    return map[diskType] || "others";
  }

  /**
   * 处理标签字段
   */
  private _processTags(tags: string[] | string | undefined): string[] {
    if (!tags) return [];
    if (Array.isArray(tags)) {
      return tags.filter((t) => typeof t === "string" && t !== "");
    }
    return [];
  }

  /**
   * 搜索指定网盘类型的所有页
   */
  private async _searchByType(
    keyword: string,
    diskType: string,
  ): Promise<SousouItem[]> {
    const promises: Promise<SousouItem[]>[] = [];

    for (let page = 1; page <= DEFAULT_MAX_PAGES; page++) {
      const apiURL = `${SOUSOU_API}?action=search&q=${encodeURIComponent(keyword)}&page=${page}&per_size=${DEFAULT_PER_SIZE}&type=${diskType}`;

      const promise = fetchWithRetry(
        apiURL,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Connection: "keep-alive",
            Referer: "https://sousou.pro/",
          },
        },
        { timeout: 30000, retries: 1 },
      )
        .then((resp) => resp.json() as Promise<SousouApiResponse>)
        .then((apiResp) => {
          if (apiResp.code !== 200) return [];
          return apiResp.data?.list || [];
        })
        .catch(() => []);

      promises.push(promise);
    }

    const pageResults = await Promise.all(promises);
    let allItems: SousouItem[] = [];
    for (const items of pageResults) {
      allItems = allItems.concat(items);
    }
    return allItems;
  }

  /**
   * 去重处理
   */
  private _deduplicateItems(items: SousouItem[]): SousouItem[] {
    const uniqueMap = new Map<string, SousouItem>();

    for (const item of items) {
      let key: string;
      if (item.disk_id) {
        key = item.disk_id;
      } else if (item.link) {
        key = item.link;
      } else {
        key = `${item.disk_name}|${item.disk_type}`;
      }

      if (uniqueMap.has(key)) {
        const existing = uniqueMap.get(key)!;
        const existingScore = (existing.files || "").length;
        let newScore = (item.files || "").length;
        if (!existing.disk_pass && item.disk_pass) newScore += 5;
        if (!existing.shared_time && item.shared_time) newScore += 3;
        if (!existing.tags && item.tags) newScore += 2;
        if (newScore > existingScore) {
          uniqueMap.set(key, item);
        }
      } else {
        uniqueMap.set(key, item);
      }
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * 将API响应转换为标准SearchResult格式
   */
  private _convertResults(items: SousouItem[]): SearchResult[] {
    const results: SearchResult[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.link) continue;

      const link: Link = {
        url: item.link,
        type: this._convertDiskType(item.disk_type || ""),
        password: item.disk_pass || "",
      };

      let uniqueId = `sousou-${item.disk_id}`;
      if (!item.disk_id) {
        uniqueId = `sousou-${Date.now()}-${i}`;
      }

      const tags = this._processTags(item.tags);

      results.push({
        uniqueId,
        title: item.disk_name || "",
        content: item.files || "",
        datetime: item.shared_time || "",
        tags,
        links: [link],
        channel: "",
      });
    }
    return results;
  }

  /**
   * 搜索
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 并发搜索每种网盘类型
    const typePromises = SUPPORTED_DISK_TYPES.map((diskType) =>
      this._searchByType(keyword, diskType).catch(() => []),
    );

    const typeResults = await Promise.all(typePromises);

    let allItems: SousouItem[] = [];
    for (const items of typeResults) {
      allItems = allItems.concat(items);
    }

    if (allItems.length === 0) {
      throw new Error("所有搜索任务都失败或无结果");
    }

    // 去重处理
    const uniqueItems = this._deduplicateItems(allItems);

    // 转换为标准格式
    const results = this._convertResults(uniqueItems);

    // 关键词过滤
    return filterByKeyword(results, keyword);
  }
}

export default SousouPlugin;
