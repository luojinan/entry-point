import { BasePlugin, fetchWithRetry, filterByKeyword } from "./base";
import type { Link, SearchResult } from "./types";

const SEARCH_API_URL = "https://feikuai.tv/t_search/bm_search.php?kw=%s";

// File extension regex
const FILE_EXT_REGEX = /\.(mkv|mp4|avi|rmvb|wmv|flv|mov|ts|m2ts|iso)$/;
// File size info regex
const FILE_SIZE_REGEX = /\s*·\s*[\d.]+\s*[KMGT]B\s*$/;

/**
 * feikuai - 飞快磁力搜索插件
 * 从飞快 API 搜索磁力链接资源
 */
class Feikuai extends BasePlugin {
  constructor() {
    super("feikuai", 3);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // Build API search URL
    const searchURL = SEARCH_API_URL.replace("%s", encodeURIComponent(keyword));

    // Fetch API
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
          Referer: "https://feikuai.tv/",
        },
      },
      { timeout: 15000, retries: 3 },
    );

    const data = (await resp.json()) as {
      code: number;
      msg?: string;
      items?: Array<{
        title?: string;
        torrents?: Array<{
          info_hash?: string;
          name?: string;
          magnet?: string;
          size_gb?: number;
          seeders?: number;
          leechers?: number;
          published_at?: string;
          published_ago?: string;
        }>;
      }>;
    };

    // Check API response
    if (data.code !== 0) {
      throw new Error(`[feikuai] API error: ${data.msg} (code: ${data.code})`);
    }

    // Parse search results
    const results: SearchResult[] = [];
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item.torrents && Array.isArray(item.torrents)) {
          for (const torrent of item.torrents) {
            const result = this._parseTorrent(keyword, item, torrent);
            if (result.title && result.links.length > 0) {
              results.push(result);
            }
          }
        }
      }
    }

    // Keyword filter
    return filterByKeyword(results, keyword);
  }

  private _parseTorrent(
    keyword: string,
    item: { title?: string },
    torrent: {
      info_hash?: string;
      name?: string;
      magnet?: string;
      size_gb?: number;
      seeders?: number;
      leechers?: number;
      published_at?: string;
      published_ago?: string;
    },
  ): SearchResult {
    // Build unique ID
    const uniqueId = `feikuai-${torrent.info_hash}`;

    // Build work title
    const workTitle = this._buildWorkTitle(keyword, torrent.name || "");

    // Build content
    const content = this._buildContent(item, torrent);

    // Parse published time
    const datetime = torrent.published_at || new Date().toISOString();

    // Extract tags
    const tags = this._extractTags(item.title || "", torrent.name || "");

    // Build magnet link
    const links: Link[] = [
      {
        type: "magnet",
        url: torrent.magnet || "",
        password: "",
      },
    ];

    return {
      uniqueId,
      title: workTitle,
      content,
      links,
      tags,
      channel: "",
      datetime,
    };
  }

  private _buildWorkTitle(keyword: string, fileName: string): string {
    // Clean file name
    const cleanedName = this._cleanFileName(fileName);

    // Check if contains keyword
    if (this._containsKeywords(keyword, cleanedName)) {
      return cleanedName;
    }

    // Prepend keyword
    return `${keyword}-${cleanedName}`;
  }

  private _cleanFileName(fileName: string): string {
    // Remove file extension
    fileName = fileName.replace(FILE_EXT_REGEX, "");
    // Remove file size info
    fileName = fileName.replace(FILE_SIZE_REGEX, "");
    // Remove date time part
    const atIdx = fileName.indexOf("@");
    if (atIdx !== -1) {
      fileName = fileName.substring(0, atIdx);
    }
    return fileName.trim();
  }

  private _containsKeywords(keyword: string, text: string): boolean {
    const keywords = this._splitKeywords(keyword);
    const lowerText = text.toLowerCase();
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  private _splitKeywords(keyword: string): string[] {
    keyword = keyword.trim();
    const separators = [
      " ",
      "\u3000",
      "，",
      "。",
      "、",
      "；",
      "：",
      "！",
      "？",
      "-",
      "_",
    ];

    let parts = [keyword];
    for (const sep of separators) {
      const newParts: string[] = [];
      for (const part of parts) {
        if (part.includes(sep)) {
          newParts.push(...part.split(sep));
        } else {
          newParts.push(part);
        }
      }
      parts = newParts;
    }

    return parts.filter((p) => p.trim().length >= 2).map((p) => p.trim());
  }

  private _buildContent(
    item: { title?: string },
    torrent: {
      name?: string;
      size_gb?: number;
      seeders?: number;
      leechers?: number;
      published_ago?: string;
    },
  ): string {
    const parts: string[] = [];
    parts.push(`文件名: ${torrent.name || ""}`);
    parts.push(`大小: ${(torrent.size_gb || 0).toFixed(2)} GB`);
    parts.push(`做种: ${torrent.seeders || 0}`);
    parts.push(`下载: ${torrent.leechers || 0}`);
    if (torrent.published_ago) {
      parts.push(`发布: ${torrent.published_ago}`);
    }
    return parts.join(" | ");
  }

  private _extractTags(title: string, fileName: string): string[] {
    const tags: string[] = [];
    const combinedText = (title + " " + fileName).toUpperCase();

    // Resolution tags
    if (combinedText.includes("2160P") || combinedText.includes("4K")) {
      tags.push("4K");
    } else if (combinedText.includes("1080P")) {
      tags.push("1080P");
    } else if (combinedText.includes("720P")) {
      tags.push("720P");
    }

    // Encoding format
    if (combinedText.includes("H265") || combinedText.includes("HEVC")) {
      tags.push("H265");
    } else if (combinedText.includes("H264") || combinedText.includes("AVC")) {
      tags.push("H264");
    }

    // HDR
    if (combinedText.includes("HDR")) {
      tags.push("HDR");
    }

    // 60fps
    if (combinedText.includes("60FPS") || combinedText.includes("60HZ")) {
      tags.push("60fps");
    }

    return tags;
  }
}

export default Feikuai;
