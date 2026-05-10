import { BasePlugin, fetchWithRetry } from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const SEARCH_URL_TEMPLATE =
  "https://linux.do/search.json?q=%s%%20in%%3Atitle%%20%%23resource&page=%d";
const MAX_PAGES = 1;

// Pre-compiled regex patterns for cloud drive links
const QUARK_REGEX = /https:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/g;
const BAIDU_REGEX =
  /https:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=([0-9a-zA-Z]+))?/g;
const ALIYUN_REGEX = /https:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9a-zA-Z]+/g;
const XUNLEI_REGEX =
  /https:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=([0-9a-zA-Z]+))?/g;
const TIANYI_REGEX = /https:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/g;
const UC_REGEX = /https:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+/g;
const PAN115_REGEX = /https:\/\/115\.com\/s\/[0-9a-zA-Z]+/g;
const BAIDU_PWD_REGEX = /(?:提取码|密码|pwd)[：:]\s*([0-9a-zA-Z]{4})/;

interface SearchData {
  posts?: Array<{
    id: number;
    topic_id: number;
    blurb?: string;
    created_at?: string;
  }>;
  topics?: Array<{
    id: number;
    title?: string;
    fancy_title?: string;
    tags?: string[];
  }>;
  grouped_search_result?: { more_full_page_results?: boolean };
}

/**
 * discourse - Linux.do Discourse 论坛插件
 * 从 linux.do 搜索 API 获取资源帖子，提取网盘链接
 *
 * 注意：linux.do 使用 Cloudflare 保护。Cloudflare Workers 无法绕过 Cloudflare，
 * 因此当检测到 Cloudflare 挑战页面时会静默返回空结果。
 */
class Discourse extends BasePlugin {
  constructor() {
    super("discourse", 2);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const maxPages = Math.min((ext.max_pages as number) || MAX_PAGES, 10);
    const startPage = (ext.page as number) || 1;
    const encodedKeyword = encodeURIComponent(keyword);

    const allResults: SearchResult[] = [];
    const seenPostIDs = new Set<string>();

    for (
      let currentPage = startPage;
      currentPage < startPage + maxPages;
      currentPage++
    ) {
      if (currentPage > startPage) {
        await new Promise((r) => setTimeout(r, 500));
      }

      const searchURL = SEARCH_URL_TEMPLATE.replace(
        "%s",
        encodedKeyword,
      ).replace("%d", String(currentPage));

      try {
        const data = await this._fetchSearchData(searchURL);
        if (!data) {
          // Cloudflare challenge or network error - return what we have
          break;
        }

        if (!data.posts || data.posts.length === 0) {
          break;
        }

        // Build topic map
        const topicMap: Record<
          number,
          { id: number; title?: string; fancy_title?: string; tags?: string[] }
        > = {};
        if (data.topics) {
          for (const topic of data.topics) {
            topicMap[topic.id] = topic;
          }
        }

        // Convert posts to results
        const pageResults = this._convertToSearchResults(data.posts, topicMap);

        for (const result of pageResults) {
          // Extract post ID from uniqueId for dedup
          const postIDMatch = result.uniqueId.match(/discourse-(\d+)/);
          const postID = postIDMatch ? postIDMatch[1] : null;

          if (postID && !seenPostIDs.has(postID)) {
            seenPostIDs.add(postID);
            allResults.push(result);
          }
        }

        // Check if more results available
        if (
          !data.grouped_search_result ||
          !data.grouped_search_result.more_full_page_results
        ) {
          break;
        }
      } catch (err) {
        // On any error, return what we have so far (graceful degradation)
        break;
      }
    }

    return allResults;
  }

  /**
   * 获取搜索数据，检测并处理 Cloudflare 挑战页面
   */
  private async _fetchSearchData(
    searchURL: string,
  ): Promise<SearchData | null> {
    try {
      const resp = await fetchWithRetry(
        searchURL,
        {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
        },
        { timeout: 30000, retries: 2, acceptNonOk: true },
      );

      // Check if response is HTML (Cloudflare challenge page)
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return null;
      }

      // Try to parse JSON
      const text = await resp.text();
      try {
        return JSON.parse(text) as SearchData;
      } catch {
        // Not valid JSON - likely Cloudflare challenge page
        return null;
      }
    } catch {
      // Network error or timeout
      return null;
    }
  }

  private _convertToSearchResults(
    posts: Array<{
      id: number;
      topic_id: number;
      blurb?: string;
      created_at?: string;
    }>,
    topicMap: Record<
      number,
      { id: number; title?: string; fancy_title?: string; tags?: string[] }
    >,
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const post of posts) {
      const topic = topicMap[post.topic_id] || {
        id: post.topic_id,
        title: "未知标题",
        tags: [],
      };

      // Extract links from blurb
      const links = this._extractNetDiskLinksFromBlurb(post.blurb || "");
      if (links.length === 0) {
        continue;
      }

      const datetime = post.created_at || "";

      results.push({
        uniqueId: `discourse-${post.id}`,
        title: topic.title || topic.fancy_title || "未知标题",
        content: this._cleanContent(post.blurb || ""),
        links,
        tags: topic.tags || [],
        channel: "",
        datetime,
      });
    }

    return results;
  }

  private _extractNetDiskLinksFromBlurb(blurb: string): Link[] {
    const links: Link[] = [];

    // Quark
    const quarkMatches = blurb.match(QUARK_REGEX) || [];
    for (const url of quarkMatches) {
      links.push({ type: "quark" as CloudType, url, password: "" });
    }

    // Baidu (with password extraction)
    const baiduRegex = new RegExp(BAIDU_REGEX.source, "g");
    let baiduMatch: RegExpExecArray | null = baiduRegex.exec(blurb);
    while (baiduMatch !== null) {
      const link: Link = {
        type: "baidu" as CloudType,
        url: baiduMatch[0],
        password: "",
      };
      if (baiduMatch[1]) {
        link.password = baiduMatch[1];
      } else {
        const pwdMatch = blurb.match(BAIDU_PWD_REGEX);
        if (pwdMatch) {
          link.password = pwdMatch[1];
        }
      }
      links.push(link);
      baiduMatch = baiduRegex.exec(blurb);
    }

    // Aliyun
    const aliyunMatches = blurb.match(ALIYUN_REGEX) || [];
    for (const url of aliyunMatches) {
      links.push({ type: "aliyun" as CloudType, url, password: "" });
    }

    // Xunlei (with password extraction)
    const xunleiRegex = new RegExp(XUNLEI_REGEX.source, "g");
    let xunleiMatch: RegExpExecArray | null = xunleiRegex.exec(blurb);
    while (xunleiMatch !== null) {
      const link: Link = {
        type: "xunlei" as CloudType,
        url: xunleiMatch[0],
        password: "",
      };
      if (xunleiMatch[1]) {
        link.password = xunleiMatch[1];
      }
      links.push(link);
      xunleiMatch = xunleiRegex.exec(blurb);
    }

    // Tianyi
    const tianyiMatches = blurb.match(TIANYI_REGEX) || [];
    for (const url of tianyiMatches) {
      links.push({ type: "tianyi" as CloudType, url, password: "" });
    }

    // UC
    const ucMatches = blurb.match(UC_REGEX) || [];
    for (const url of ucMatches) {
      links.push({ type: "uc" as CloudType, url, password: "" });
    }

    // 115
    const pan115Matches = blurb.match(PAN115_REGEX) || [];
    for (const url of pan115Matches) {
      links.push({ type: "115" as CloudType, url, password: "" });
    }

    return links;
  }

  private _cleanContent(content: string): string {
    // Remove HTML tags
    content = content.replace(/<[^>]+>/g, "");
    // Decode HTML entities
    content = content
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    // Remove excess whitespace
    content = content.replace(/\s+/g, " ").trim();
    if (content.length > 200) {
      content = content.substring(0, 200) + "...";
    }
    return content;
  }
}

export default Discourse;
