import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

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
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "hdr4k";
const SEARCH_URL = "https://www.4khdr.cn/search.php?mod=forum";
const THREAD_URL_PATTERN = "https://www.4khdr.cn/thread-%s-1-1.html";
const MAX_CONCURRENCY = 20;

interface SearchItem {
  el: any;
  postID: string;
  title: string;
  content: string;
}

interface DetailResult {
  links: Link[];
  detailContent: string;
}

class Hdr4kPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 1);
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    let searchKeyword = keyword;
    if (
      ext &&
      ext.title_en &&
      typeof ext.title_en === "string" &&
      ext.title_en !== ""
    ) {
      searchKeyword = ext.title_en;
    }

    // Build POST request
    const formData = new URLSearchParams();
    formData.set("srchtxt", searchKeyword);
    formData.set("searchsubmit", "yes");

    const resp = await fetchWithRetry(
      SEARCH_URL,
      {
        method: "POST",
        headers: {
          "User-Agent": getRandomUA(),
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://www.4khdr.cn/",
        },
        body: formData.toString(),
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Keyword filtering
    const lowerKeyword = keyword.toLowerCase();
    const keywords = lowerKeyword.split(/\s+/).filter(Boolean);

    // Collect matching items
    const items: SearchItem[] = [];
    $(".slst.mtw ul li.pbw").each((i, el) => {
      const s = $(el);
      const postID = s.attr("id");
      if (!postID) {
        return;
      }

      const title = this.cleanHTMLText(s.find("h3.xs3 a").text()).trim();
      if (!title) {
        return;
      }

      const content = this.cleanHTMLText(s.find("p").first().text()).trim();

      const lowerTitle = title.toLowerCase();
      const lowerContent = content.toLowerCase();

      // Check keywords
      const matched = keywords.every(
        (kw) => lowerTitle.includes(kw) || lowerContent.includes(kw),
      );
      if (!matched) {
        return;
      }

      items.push({ el: s, postID, title, content });
    });

    // Concurrently fetch detail pages
    const tasks = items.map(async (item) => {
      try {
        // Extract date
        let datetime = "";
        const dateEl = item.el.find("p span");
        if (dateEl.length > 0) {
          datetime = dateEl.first().text().trim();
        }

        // Extract tags
        const tags: string[] = [];
        const categoryEl = item.el.find("p span a.xi1");
        if (categoryEl.length > 0) {
          const cat = categoryEl.text().trim();
          if (cat) {
            tags.push(cat);
          }
        }

        const { links, detailContent } = await this.getLinksFromDetail(
          item.postID,
        );

        // Filter empty request posts
        if (this.isEmptyRequestPost(item.title, links)) {
          return null;
        }

        const content = detailContent || item.content;

        return {
          uniqueId: `hdr4k-${item.postID}`,
          title: item.title,
          content,
          datetime: datetime || new Date().toISOString(),
          links,
          tags,
          channel: "",
        };
      } catch (e) {
        return null;
      }
    });

    const settled = await Promise.all(tasks);
    return settled.filter(
      (r): r is NonNullable<typeof r> => r !== null,
    ) as SearchResult[];
  }

  private isEmptyRequestPost(title: string, links: Link[]): boolean {
    const lowerTitle = title.toLowerCase();

    if (links.length > 0) {
      return false;
    }

    const emptyRequestKeywords = [
      "\u6C42\u7247",
      "\u6709\u8D44\u6E90\u5417",
      "\u6709\u6CA1\u6709\u8D44\u6E90",
      "\u8DEA\u6C42",
      "\u6C42\u8D44\u6E90",
    ];
    for (const kw of emptyRequestKeywords) {
      if (lowerTitle.includes(kw)) {
        return true;
      }
    }

    const cloudRequestKeywords = [
      "\u6C42\u963F\u91CC\u4E91\u76D8",
      "\u6C42\u767E\u5EA6\u7F51\u76D8",
      "\u6C42\u5938\u514B\u7F51\u76D8",
      "\u6C42\u8FC5\u96F7\u7F51\u76D8",
      "\u6C42\u5929\u7FFC\u4E91\u76D8",
    ];
    for (const kw of cloudRequestKeywords) {
      if (lowerTitle.includes(kw)) {
        return links.length === 0;
      }
    }

    if (lowerTitle.startsWith("\u6C42")) {
      if (
        [...title].length < 10 &&
        !lowerTitle.includes("\u5E74") &&
        !lowerTitle.includes("\u5B63") &&
        links.length === 0
      ) {
        return true;
      }
    }

    return false;
  }

  private async getLinksFromDetail(postID: string): Promise<DetailResult> {
    const detailURL = THREAD_URL_PATTERN.replace("%s", postID);

    try {
      const resp = await fetchWithRetry(
        detailURL,
        {
          headers: {
            "User-Agent": getRandomUA(),
            Referer: "https://www.4khdr.cn/",
          },
        },
        { timeout: 30000, retries: 2 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      const links: Link[] = [];
      let detailContent = "";

      const contentSelectors = [".t_f", "[id^=postmessage_]"];

      for (const selector of contentSelectors) {
        $(selector).each((i, el) => {
          if (!detailContent) {
            const content = this.cleanHTMLText($(el).text()).trim();
            if (content.length > 500) {
              detailContent = content.substring(0, 500) + "...";
            } else if (content.length > 50) {
              detailContent = content;
            }
          }

          $(el)
            .find("a")
            .each((j, linkEl) => {
              const href = $(linkEl).attr("href");
              if (!href) {
                return;
              }

              const linkType = this.determineLinkType(href);
              if (linkType !== "others") {
                // Deduplicate
                if (!links.some((l) => l.url === href)) {
                  links.push({
                    type: linkType,
                    url: href,
                    password: "",
                  });
                }
              }
            });
        });
      }

      return { links, detailContent };
    } catch (e) {
      return { links: [], detailContent: "" };
    }
  }

  private determineLinkType(url: string): CloudType {
    const lower = url.toLowerCase();

    if (lower.includes("pan.quark.cn")) {
      return "quark";
    }
    if (lower.includes("pan.baidu.com")) {
      return "baidu";
    }
    if (lower.includes("alipan.com") || lower.includes("aliyundrive.com")) {
      return "aliyun";
    }
    if (lower.includes("pan.xunlei.com")) {
      return "xunlei";
    }
    if (lower.includes("cloud.189.cn")) {
      return "tianyi";
    }
    if (lower.includes("115.com")) {
      return "115";
    }
    if (lower.includes("drive.uc.cn")) {
      return "uc";
    }
    if (lower.includes("caiyun.139.com")) {
      return "mobile";
    }
    if (lower.includes("share.weiyun.com")) {
      return "weiyun";
    }
    if (lower.includes("lanzou")) {
      return "lanzou";
    }
    if (lower.includes("123pan.com")) {
      return "123";
    }
    if (lower.includes("mypikpak.com")) {
      return "pikpak";
    }
    if (lower.startsWith("magnet:")) {
      return "magnet";
    }
    if (lower.startsWith("ed2k:")) {
      return "ed2k";
    }

    return "others" as CloudType;
  }

  private cleanHTMLText(html: string): string {
    if (!html) {
      return "";
    }
    const replacements: Record<string, string> = {
      "<strong>": "",
      "</strong>": "",
      '<font color="#ff0000">': "",
      "</font>": "",
      "<em>": "",
      "</em>": "",
      "<b>": "",
      "</b>": "",
      "<br>": "\n",
      "<br/>": "\n",
      "<br />": "\n",
      "&nbsp;": " ",
      "&hellip;": "...",
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#039;": "'",
    };

    let result = html;
    for (const [old, rep] of Object.entries(replacements)) {
      result = result.split(old).join(rep);
    }

    result = result.replace(/<[^>]*>/g, "");
    result = result.replace(/\s+/g, " ");
    return result.trim();
  }
}

export default Hdr4kPlugin;
