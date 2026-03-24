/**
 * qupanshe 插件 - 趣盘社搜索
 * 翻译自 Go 插件: plugin/qupanshe/qupanshe.go
 */

import * as cheerio from "cheerio";
import {
  BasePlugin,
  extractPassword,
  fetchWithRetry,
  fetchWithTimeout,
  filterByKeyword,
  generateUniqueID,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://www.qupanshe.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

class QupanshePlugin extends BasePlugin {
  constructor() {
    super("qupanshe", 3);
  }

  /**
   * 设置通用请求头
   */
  private _getHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Referer: BASE_URL + "/",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      ...extra,
    };
  }

  /**
   * 从首页获取formhash
   */
  private async _getFormhash(cookieJar: string[]): Promise<string> {
    const resp = await fetchWithTimeout(
      BASE_URL,
      {
        headers: this._getHeaders(),
        redirect: "follow",
      },
      45000,
    );

    if (!resp.ok) throw new Error(`首页请求返回状态码: ${resp.status}`);

    // 收集cookies
    const setCookies = resp.headers.getSetCookie
      ? resp.headers.getSetCookie()
      : [];
    for (const cookie of setCookies) {
      const parts = cookie.split(";")[0];
      cookieJar.push(parts);
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    let formhash = "";
    $("input[name='formhash']").each((i, el) => {
      const value = $(el).attr("value");
      if (value) formhash = value;
    });

    if (!formhash) throw new Error("未找到formhash值");
    return formhash;
  }

  /**
   * POST搜索请求获取搜索结果URL
   */
  private async _postSearchRequest(
    keyword: string,
    formhash: string,
    cookieJar: string[],
  ): Promise<string> {
    // 添加延时避免过快
    await new Promise((r) => setTimeout(r, 2000));

    const searchURL = `${BASE_URL}/search.php?mod=forum`;
    const body = new URLSearchParams({
      formhash,
      srchtxt: keyword,
      searchsubmit: "yes",
    });

    const resp = await fetchWithTimeout(
      searchURL,
      {
        method: "POST",
        headers: {
          ...this._getHeaders({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
          Cookie: cookieJar.join("; "),
        },
        body: body.toString(),
        redirect: "manual", // 不自动跟随重定向
      },
      45000,
    );

    // 收集cookies
    const setCookies = resp.headers.getSetCookie
      ? resp.headers.getSetCookie()
      : [];
    for (const cookie of setCookies) {
      const parts = cookie.split(";")[0];
      cookieJar.push(parts);
    }

    const location = resp.headers.get("location");
    if (!location) {
      throw new Error(`未获取到重定向URL，状态码: ${resp.status}`);
    }

    // 将相对路径转换为完整URL
    const fullURL = BASE_URL + "/" + location.replace(/^\//, "");
    return fullURL;
  }

  /**
   * 确定链接类型
   */
  private _determineLinkType(urlStr: string): string {
    const patterns: Record<string, string> = {
      "pan\\.quark\\.cn": "quark",
      "pan\\.baidu\\.com": "baidu",
      "www\\.alipan\\.com": "aliyun",
      "aliyundrive\\.com": "aliyun",
      "pan\\.xunlei\\.com": "xunlei",
      "cloud\\.189\\.cn": "tianyi",
      "pan\\.uc\\.cn": "uc",
      "www\\.123pan\\.com": "123",
      "www\\.123684\\.com": "123",
      "115cdn\\.com": "115",
      "115\\.com": "115",
      "pan\\.pikpak\\.com": "pikpak",
      "mypikpak\\.com": "pikpak",
      "caiyun\\.139\\.cn": "mobile",
    };

    for (const [pattern, type] of Object.entries(patterns)) {
      if (new RegExp(pattern).test(urlStr)) return type;
    }
    return "";
  }

  /**
   * 从文本中提取链接
   */
  private _extractLinksFromText(text: string): Link[] {
    const links: Link[] = [];
    const patterns = [
      /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]+)?/g,
      /https?:\/\/www\.alipan\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/aliyundrive\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/cloud\.189\.cn\/[a-zA-Z0-9_/-]+/g,
      /https?:\/\/pan\.uc\.cn\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/www\.123pan\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/www\.123684\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/115cdn\.com\/[a-zA-Z0-9_/-]+/g,
      /https?:\/\/115\.com\/[a-zA-Z0-9_/-]+/g,
      /https?:\/\/pan\.pikpak\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/mypikpak\.com\/s\/[a-zA-Z0-9_-]+/g,
      /https?:\/\/caiyun\.139\.com\/[a-zA-Z0-9_/-]+/g,
    ];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const url = match[0];
        const linkType = this._determineLinkType(url);
        if (linkType) {
          const password = this._extractPasswordFromContent(text, url);
          links.push({ type: linkType as CloudType, url, password });
        }
      }
    }
    return links;
  }

  /**
   * 从内容中提取密码
   */
  private _extractPasswordFromContent(
    content: string,
    linkURL: string,
  ): string {
    // 先尝试从URL中提取pwd参数
    try {
      const parsed = new URL(linkURL);
      const pwd = parsed.searchParams.get("pwd");
      if (pwd) return pwd;
    } catch (e) {
      /* ignore */
    }

    const linkIndex = content.indexOf(linkURL);
    if (linkIndex === -1) return "";

    const start = Math.max(0, linkIndex - 20);
    const end = Math.min(content.length, linkIndex + linkURL.length + 100);
    const surroundingText = content.slice(start, end);

    const passwordPatterns = [
      /提取码[：:]\s*([A-Za-z0-9]+)/,
      /密码[：:]\s*([A-Za-z0-9]+)/,
      /pwd[：:=]\s*([A-Za-z0-9]+)/,
      /password[：:=]\s*([A-Za-z0-9]+)/,
    ];

    for (const pattern of passwordPatterns) {
      const m = surroundingText.match(pattern);
      if (m) return m[1];
    }
    return "";
  }

  /**
   * 链接去重
   */
  private _deduplicateLinks(links: Link[]): Link[] {
    const linkMap = new Map<string, Link>();
    for (const link of links) {
      // 去除URL中的密码参数来归一化
      let normalizedURL = link.url;
      let password = link.password || "";
      try {
        const parsed = new URL(link.url);
        const pwdKeys = ["pwd", "password", "pass", "code"];
        for (const key of pwdKeys) {
          const val = parsed.searchParams.get(key);
          if (val) {
            password = val;
            parsed.searchParams.delete(key);
          }
        }
        normalizedURL = parsed.toString().replace(/\?$/, "");
      } catch (e) {
        /* ignore */
      }

      const existing = linkMap.get(normalizedURL);
      if (existing) {
        if (password && !existing.password) {
          linkMap.set(normalizedURL, { ...link, password });
        }
      } else {
        linkMap.set(normalizedURL, { ...link, password });
      }
    }
    return Array.from(linkMap.values());
  }

  /**
   * 清理标题
   */
  private _cleanTitle(titleHTML: string): string {
    let title = titleHTML.replace(/<[^>]*>/g, "");
    title = title.replace(/&nbsp;/g, " ");
    title = title.replace(/&amp;/g, "&");
    title = title.replace(/&lt;/g, "<");
    title = title.replace(/&gt;/g, ">");
    title = title.replace(/&quot;/g, '"');
    return title.trim();
  }

  /**
   * 解析时间字符串
   */
  private _parseTime(timeStr: string): string {
    if (!timeStr) return "";
    timeStr = timeStr.trim();
    // 尝试直接解析
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) return d.toISOString();
    return "";
  }

  /**
   * 获取搜索结果
   */
  private async _getSearchResults(
    searchURL: string,
    keyword: string,
    cookieJar: string[],
  ): Promise<SearchResult[]> {
    const resp = await fetchWithTimeout(
      searchURL,
      {
        headers: {
          ...this._getHeaders(),
          Cookie: cookieJar.join("; "),
        },
        redirect: "follow",
      },
      45000,
    );

    if (!resp.ok) throw new Error(`请求返回状态码: ${resp.status}`);

    const html = await resp.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $("li.pbw").each((i, el) => {
      const s = $(el);
      const postID = s.attr("id") || `${Date.now()}-${i}`;

      // 提取标题
      const titleLink = s.find("h3.xs3 a").first();
      const titleHTML = titleLink.html() || "";
      const title = this._cleanTitle(titleHTML);
      if (!title) return;

      // 提取详情页链接
      const detailPath = titleLink.attr("href") || "";
      let detailURL = "";
      if (detailPath) {
        detailURL = detailPath.startsWith("http")
          ? detailPath
          : BASE_URL + "/" + detailPath.replace(/^\//, "");
      }

      // 提取内容摘要（第二个p标签）
      let content = "";
      s.find("p").each((j, p) => {
        if (j === 1) content = $(p).text().trim();
      });

      // 从<a>标签提取链接
      let links: Link[] = [];
      s.find("p")
        .eq(1)
        .find("a")
        .each((j, a) => {
          const href = $(a).attr("href");
          if (!href) return;
          const linkType = this._determineLinkType(href);
          if (linkType) {
            const password = this._extractPasswordFromContent(content, href);
            links.push({ type: linkType as CloudType, url: href, password });
          }
        });

      // 从纯文本中提取链接
      const textLinks = this._extractLinksFromText(content);
      links = links.concat(textLinks);

      // 去重
      links = this._deduplicateLinks(links);

      // 提取时间、作者、分类
      const lastP = s.find("p").last();
      const spans = lastP.find("span");
      let publishTime = "",
        author = "",
        category = "";
      if (spans.length >= 3) {
        publishTime = spans.eq(0).text().trim();
        author = spans.eq(1).find("a").text().trim();
        category = spans.eq(2).find("a").text().trim();
      }

      const datetime = this._parseTime(publishTime);

      let enrichedContent = content;
      if (detailURL) {
        enrichedContent = `${content} | 作者: ${author} | 分类: ${category} | 详情: ${detailURL}`;
      }

      results.push({
        uniqueId: `qupanshe-${postID}`,
        title,
        content: enrichedContent,
        links,
        datetime,
        tags: [],
        channel: "",
      });
    });

    return results;
  }

  /**
   * 搜索
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    // 使用简单数组模拟cookie jar
    const cookieJar: string[] = [];

    // Step 1: 获取首页formhash
    const formhash = await this._getFormhash(cookieJar);
    console.log("formhash", formhash);

    // Step 2: POST请求获取搜索结果URL
    const searchURL = await this._postSearchRequest(
      keyword,
      formhash,
      cookieJar,
    );

    console.log("searchURL", searchURL, keyword, cookieJar);

    // Step 3: GET请求获取搜索结果
    const results = await this._getSearchResults(searchURL, keyword, cookieJar);

    console.log("results", results);

    // Step 4: 关键词过滤
    return filterByKeyword(results, keyword);
  }
}

export default QupanshePlugin;
