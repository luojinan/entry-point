import * as cheerio from 'cheerio';
import {
  BasePlugin,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  filterByKeyword,
  generateUniqueID,
} from "./base";
import type { Link, SearchResult } from "./types";

/**
 * ahhhhfs 插件 - ahhhhfs.com 网盘资源搜索
 * 搜索列表页 + 详情页抓取网盘链接
 */
class AhhhhfsPlugin extends BasePlugin {
  private articleIDRegex: RegExp;
  private pwdPatterns: RegExp[];

  constructor() {
    super("ahhhhfs", 2);
    this.articleIDRegex = /\/(\d+)\/?$/;
    this.pwdPatterns = [
      /提取码[：:]\s*([0-9a-zA-Z]+)/,
      /密码[：:]\s*([0-9a-zA-Z]+)/,
      /pwd[=:：]\s*([0-9a-zA-Z]+)/,
      /code[=:：]\s*([0-9a-zA-Z]+)/,
    ];
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = `https://www.ahhhhfs.com/?cat=&s=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
          Referer: "https://www.ahhhhfs.com/",
        },
      },
      { timeout: 10000, retries: 3 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract article items from search page
    const articleItems: Array<{
      title: string;
      detailURL: string;
      articleID: string;
      content: string;
      tags: string[];
      datetime: string;
    }> = [];

    $("article.post-item.item-list").each((i, el) => {
      const titleElem = $(el).find(".entry-title a");
      let title = titleElem.text().trim();
      if (!title) {
        title = (titleElem.attr("title") || "").trim();
      }

      const detailURL = titleElem.attr("href");
      if (!detailURL || !title) return;

      const articleID = this._extractArticleID(detailURL);
      if (!articleID) return;

      const tags: string[] = [];
      $(el)
        .find(".entry-cat-dot a")
        .each((j, tag) => {
          const tagText = $(tag).text().trim();
          if (tagText) tags.push(tagText);
        });

      const content = $(el).find(".entry-desc").text().trim();

      let datetime = "";
      const timeElem = $(el).find(".entry-meta .meta-date time");
      datetime = timeElem.attr("datetime") || timeElem.text().trim();

      articleItems.push({
        title,
        detailURL,
        articleID,
        content,
        tags,
        datetime,
      });
    });

    // Fetch detail pages concurrently
    const detailPromises = articleItems.map((item) =>
      this._fetchDetailLinks(item.detailURL).catch(() => [] as Link[]),
    );
    const detailResults = await Promise.all(detailPromises);

    const results: SearchResult[] = [];
    for (let i = 0; i < articleItems.length; i++) {
      const links = detailResults[i];
      if (links.length > 0) {
        results.push({
          uniqueId: `${this.name}-${articleItems[i].articleID}`,
          title: articleItems[i].title,
          content: articleItems[i].content,
          links,
          datetime: articleItems[i].datetime,
          tags: articleItems[i].tags,
          channel: "",
        });
      }
    }

    return filterByKeyword(results, keyword);
  }

  private _extractArticleID(detailURL: string): string {
    const matches = this.articleIDRegex.exec(detailURL);
    return matches ? matches[1] : "";
  }

  private async _fetchDetailLinks(detailURL: string): Promise<Link[]> {
    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://www.ahhhhfs.com/",
        },
      },
      { timeout: 8000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const links: Link[] = [];
    const linkMap = new Set<string>();

    $(".post-content a").each((i, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const cloudType = determineCloudType(href);
      if (cloudType === "others") return;

      if (linkMap.has(href)) return;
      linkMap.add(href);

      // Extract password from link context
      let password = "";

      // From title attribute
      const titleAttr = $(el).attr("title") || "";
      password = this._matchPassword(titleAttr);

      // From link text
      if (!password) {
        password = this._matchPassword($(el).text());
      }

      // From parent text after link
      if (!password) {
        const parentText = $(el).parent().text();
        const linkText = $(el).text();
        const linkIndex = parentText.indexOf(linkText);
        if (linkIndex >= 0) {
          const afterText = parentText.substring(linkIndex + linkText.length);
          password = this._matchPassword(afterText);
        }
      }

      // From URL pwd= parameter
      if (!password && href.includes("pwd=")) {
        const parts = href.split("pwd=");
        if (parts.length >= 2) {
          let pwd = parts[1];
          const idx = pwd.search(/[&?#]/);
          if (idx >= 0) pwd = pwd.substring(0, idx);
          password = pwd;
        }
      }

      links.push({ type: cloudType, url: href, password });
    });

    return links;
  }

  private _matchPassword(text: string): string {
    if (!text) return "";
    for (const pattern of this.pwdPatterns) {
      const m = text.match(pattern);
      if (m) return m[1];
    }
    return "";
  }
}

export default AhhhhfsPlugin;
