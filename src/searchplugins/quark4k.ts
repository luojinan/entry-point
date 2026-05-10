/**
 * quark4k 插件 - quark4k.com 论坛搜索
 * 翻译自 Go 插件: plugin/quark4k/quark4k.go
 */

import {
  BasePlugin,
  cleanHTML,
  deduplicateResults,
  fetchWithRetry,
  filterByKeyword,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://quark4k.com/api/discussions";
const PAGE_SIZE = 50;

interface LinkInfo {
  link: Link;
  position: number;
  category: string;
}

interface PasswordInfo {
  keyword: string;
  position: number;
  password: string;
}

class Quark4KPlugin extends BasePlugin {
  constructor() {
    super("quark4k", 3);
  }

  /**
   * 生成随机IP
   */
  private _generateRandomIP(): string {
    const a = Math.floor(Math.random() * 223) + 1;
    const b = Math.floor(Math.random() * 255);
    const c = Math.floor(Math.random() * 255);
    const d = Math.floor(Math.random() * 254) + 1;
    return `${a}.${b}.${c}.${d}`;
  }

  /**
   * 清理HTML内容 (quark4k专用，保留换行)
   */
  private _cleanHTML(html: string): string {
    if (!html) {
      return "";
    }
    // 替换<br>标签为换行
    html = html.replace(/<br\s*\/?>/gi, "\n");
    // 移除其他HTML标签
    html = html.replace(/<[^>]+>/g, "");
    // 处理HTML实体
    html = html.replace(/&amp;/g, "&");
    html = html.replace(/&lt;/g, "<");
    html = html.replace(/&gt;/g, ">");
    html = html.replace(/&quot;/g, '"');
    html = html.replace(/&apos;/g, "'");
    html = html.replace(/&#39;/g, "'");
    html = html.replace(/&nbsp;/g, " ");
    // 处理多行空白
    const lines = html.split("\n");
    const cleanedLines = lines.map((l) => l.trim()).filter((l) => l !== "");
    return cleanedLines.join("\n");
  }

  /**
   * 从文本中提取URL
   */
  private _extractURLFromText(text: string): string {
    const prefixes = ["http://", "https://"];
    let start = -1;
    for (const prefix of prefixes) {
      const pos = text.indexOf(prefix);
      if (pos !== -1) {
        start = pos;
        break;
      }
    }
    if (start === -1) {
      return "";
    }

    let end = text.length;
    const endChars = [
      " ",
      "\t",
      "\n",
      '"',
      "'",
      "<",
      ">",
      ")",
      "]",
      "}",
      ",",
      ";",
    ];
    for (const char of endChars) {
      const pos = text.indexOf(char, start);
      if (pos !== -1 && pos < end) {
        end = pos;
      }
    }
    return text.slice(start, end);
  }

  /**
   * 从URL中提取密码参数
   */
  private _extractPasswordFromURL(url: string): string {
    const pwdParams = ["pwd=", "password=", "passcode=", "code="];
    for (const param of pwdParams) {
      const pos = url.indexOf(param);
      if (pos !== -1) {
        const start = pos + param.length;
        let end = url.length;
        for (let i = start; i < url.length; i++) {
          if (url[i] === "&" || url[i] === "#") {
            end = i;
            break;
          }
        }
        if (start < end) {
          return url.slice(start, end);
        }
      }
    }
    return "";
  }

  /**
   * 从文本提取夸克网盘链接
   */
  private _extractQuarkLinksFromText(content: string): Link[] {
    const lines = content.split("\n");
    const linkInfos: LinkInfo[] = [];
    const passwordInfos: PasswordInfo[] = [];

    // 第一遍：查找所有的链接和密码
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检查夸克网盘
      if (line.includes("pan.quark.cn")) {
        const url = this._extractURLFromText(line);
        if (url) {
          linkInfos.push({
            link: { url, type: "quark" as CloudType, password: "" },
            position: i,
            category: "quark",
          });
        }
      }

      // 检查提取码/密码
      const passwordKeywords = ["提取码", "密码"];
      for (const keyword of passwordKeywords) {
        if (line.includes(keyword)) {
          let colonPos = line.indexOf(":");
          if (colonPos === -1) {
            colonPos = line.indexOf("：");
          }
          if (colonPos !== -1 && colonPos + 1 < line.length) {
            const password = line.slice(colonPos + 1).trim();
            if (password.length <= 10) {
              passwordInfos.push({ keyword, position: i, password });
            }
          }
        }
      }
    }

    // 第二遍：将密码与链接匹配
    for (const info of linkInfos) {
      // 检查链接自身是否包含密码
      const urlPwd = this._extractPasswordFromURL(info.link.url);
      if (urlPwd) {
        info.link.password = urlPwd;
        continue;
      }

      // 查找最近的密码
      let minDistance = 1000000;
      let closestPassword = "";
      for (const pwInfo of passwordInfos) {
        if (
          info.category === "quark" &&
          (pwInfo.keyword === "提取码" || pwInfo.keyword === "密码")
        ) {
          const distance = Math.abs(pwInfo.position - info.position);
          if (distance < minDistance) {
            minDistance = distance;
            closestPassword = pwInfo.password;
          }
        }
      }
      if (minDistance <= 3) {
        info.link.password = closestPassword;
      }
    }

    return linkInfos.map((info) => info.link);
  }

  /**
   * 获取单页搜索结果
   */
  private async _fetchPage(
    keyword: string,
    offset: number,
  ): Promise<SearchResult[]> {
    const apiURL = `${BASE_URL}?include=user%2ClastPostedUser%2CmostRelevantPost%2CmostRelevantPost.user%2Ctags%2Ctags.parent%2CfirstPost&filter[q]=${encodeURIComponent(keyword)}&sort&page[offset]=${offset}&page[limit]=${PAGE_SIZE}`;

    const resp = await fetchWithRetry(
      apiURL,
      {
        headers: {
          "User-Agent": getRandomUA(),
          "X-Forwarded-For": this._generateRandomIP(),
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          Referer: "https://quark4k.com/",
        },
      },
      { timeout: 10000, retries: 2 },
    );

    const apiResp = (await resp.json()) as any;

    // 构建帖子ID到帖子内容的映射
    const postMap: Record<string, any> = {};
    if (apiResp.included) {
      for (const item of apiResp.included) {
        if (item.type === "posts") {
          postMap[item.id] = item;
        }
      }
    }

    const results: SearchResult[] = [];
    const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);

    if (apiResp.data) {
      for (const discussion of apiResp.data) {
        // 检查标题是否包含关键词
        const lowerTitle = (discussion.attributes?.title || "").toLowerCase();
        const titleMatched = keywords.every((kw) => lowerTitle.includes(kw));
        if (!titleMatched) {
          continue;
        }

        // 获取相关帖子
        const postID = discussion.relationships?.mostRelevantPost?.data?.id;
        const post = postMap[postID];
        if (!post) {
          continue;
        }

        // 清理HTML内容
        const cleanedHTML = this._cleanHTML(post.attributes?.contentHtml || "");

        // 提取链接
        const links = this._extractQuarkLinksFromText(cleanedHTML);
        if (links.length === 0) {
          continue;
        }

        // 解析时间
        let datetime = "";
        if (discussion.attributes?.createdAt) {
          datetime = discussion.attributes.createdAt;
        }

        const uniqueId = `quark4k-${discussion.id}`;

        results.push({
          uniqueId,
          title: discussion.attributes?.title || "",
          content: cleanedHTML,
          links,
          datetime,
          tags: [],
          channel: "",
        });
      }
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
    // 并发请求2个页面 (0和1页)
    const promises = [
      this._fetchPage(keyword, 0),
      this._fetchPage(keyword, PAGE_SIZE),
    ];

    const pageResults = await Promise.allSettled(promises);
    let allResults: SearchResult[] = [];
    for (const result of pageResults) {
      if (result.status === "fulfilled") {
        allResults = allResults.concat(result.value);
      }
    }

    // 去重
    allResults = deduplicateResults(allResults);

    // 按时间降序排序
    allResults.sort((a, b) => {
      if (!a.datetime && !b.datetime) {
        return 0;
      }
      if (!a.datetime) {
        return 1;
      }
      if (!b.datetime) {
        return -1;
      }
      return new Date(b.datetime).getTime() - new Date(a.datetime).getTime();
    });

    // 关键词过滤
    return filterByKeyword(allResults, keyword);
  }
}

export default Quark4KPlugin;
