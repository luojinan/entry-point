import * as cheerio from 'cheerio';
import {
  BasePlugin,
  cleanHTML,
  fetchWithRetry,
  filterByKeyword,
  generateUniqueID,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "panwiki";
const PRIMARY_BASE_URL = "https://www.panwiki.com";
const BACKUP_BASE_URL = "https://pan666.net";
const SEARCH_PATH =
  "/search.php?mod=forum&srchtxt=%s&searchsubmit=yes&orderby=lastpost";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const MAX_CONCURRENCY = 40;
const MAX_PAGES = 2;

interface LinkPattern {
  re: RegExp;
  type: string;
}

const LINK_PATTERNS: LinkPattern[] = [
  { re: /https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9_-]+/g, type: "quark" },
  { re: /https:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+/g, type: "baidu" },
  { re: /https:\/\/www\.alipan\.com\/s\/[a-zA-Z0-9_-]+/g, type: "aliyun" },
  { re: /https:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9_-]+/g, type: "xunlei" },
  { re: /https:\/\/cloud\.189\.cn\/[a-zA-Z0-9_-]+/g, type: "tianyi" },
  { re: /https:\/\/pan\.uc\.cn\/s\/[a-zA-Z0-9_-]+/g, type: "uc" },
  { re: /https:\/\/www\.123pan\.com\/s\/[a-zA-Z0-9_-]+/g, type: "123" },
  { re: /https:\/\/www\.123684\.com\/s\/[a-zA-Z0-9_-]+/g, type: "123" },
  { re: /https:\/\/115cdn\.com\/s\/[a-zA-Z0-9_-]+/g, type: "115" },
  { re: /https:\/\/pan\.pikpak\.com\/s\/[a-zA-Z0-9_-]+/g, type: "pikpak" },
  { re: /https:\/\/caiyun\.139\.cn\/s\/[a-zA-Z0-9_-]+/g, type: "mobile" },
];

interface LinkTypeRule {
  pattern: RegExp;
  type: string;
}

const LINK_TYPE_RULES: LinkTypeRule[] = [
  { pattern: /pan\.quark\.cn/, type: "quark" },
  { pattern: /pan\.baidu\.com/, type: "baidu" },
  { pattern: /www\.alipan\.com/, type: "aliyun" },
  { pattern: /pan\.xunlei\.com/, type: "xunlei" },
  { pattern: /cloud\.189\.cn/, type: "tianyi" },
  { pattern: /pan\.uc\.cn/, type: "uc" },
  { pattern: /www\.123pan\.com/, type: "123" },
  { pattern: /www\.123684\.com/, type: "123" },
  { pattern: /115cdn\.com/, type: "115" },
  { pattern: /pan\.pikpak\.com/, type: "pikpak" },
  { pattern: /caiyun\.139\.cn/, type: "mobile" },
];

const NETWORK_DOMAINS = [
  "pan.quark.cn",
  "pan.baidu.com",
  "www.alipan.com",
  "caiyun.139.com",
  "pan.xunlei.com",
  "drive.uc.cn",
  "www.123684.com",
  "115cdn.com",
  "cloud.189.cn",
  "pan.uc.cn",
  "www.123pan.com",
  "pan.pikpak.com",
];

const AD_PATTERNS = [
  /【[^】]*(?:论坛|网站|\.com|\.net|\.cn)[^】]*】/g,
  /\[[^\]]*(?:论坛|网站|\.com|\.net|\.cn)[^\]]*\]/g,
];

const PASSWORD_PATTERNS = [
  /提取码[：:]\s*([A-Za-z0-9]+)/,
  /密码[：:]\s*([A-Za-z0-9]+)/,
  /pwd[：:=]\s*([A-Za-z0-9]+)/,
  /password[：:=]\s*([A-Za-z0-9]+)/,
];

const NON_TITLE_PREFIXES = [
  "导演:",
  "编剧:",
  "主演:",
  "类型:",
  "制片国家",
  "语言:",
  "首播:",
  "集数:",
  "单集片长:",
  "评分:",
  "简介:",
  "链接：",
  "链接:",
  "夸克网盘：",
  "百度网盘：",
  "阿里云盘：",
  "迅雷网盘：",
];

const TITLE_INDICATORS = [
  "4K持续更新",
  "集完结",
  "完结",
  "4K高码",
  "持续更新",
  "全集",
  "集】",
  "更新",
  "剧版",
  "真人版",
  "动画版",
];

const SINGLE_LINE_PATTERN = /[^丨]*丨[^：]*：https?:\/\/[^\s]+/;
const SINGLE_LINE_EXTRACT =
  /([^丨]+)丨([^：]+)：(https?:\/\/[a-zA-Z0-9.\-_?=&/]+)/g;

function makeHeaders(baseURL: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Referer: baseURL + "/",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

function determineLinkType(url: string): string {
  for (const rule of LINK_TYPE_RULES) {
    if (rule.pattern.test(url)) return rule.type;
  }
  return "";
}

function extractLinksFromText(text: string): Link[] {
  const links: Link[] = [];
  for (const { re, type } of LINK_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
      links.push({ url: m[0], type: type as CloudType, password: "" });
      m = re.exec(text);
    }
  }
  return links;
}

interface URLPasswordResult {
  normalizedURL: string;
  password: string;
}

function extractPasswordFromURL(rawURL: string): URLPasswordResult {
  try {
    const u = new URL(rawURL);
    const keys = ["pwd", "password", "pass", "code"];
    let password = "";
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v) {
        password = v;
        break;
      }
    }
    for (const k of keys) {
      u.searchParams.delete(k);
    }
    let normalized = u.toString();
    if (normalized.endsWith("?")) {
      normalized = normalized.slice(0, -1);
    }
    return { normalizedURL: normalized, password };
  } catch {
    return { normalizedURL: rawURL, password: "" };
  }
}

function extractPasswordFromContent(content: string, linkURL: string): string {
  const idx = content.indexOf(linkURL);
  if (idx === -1) return "";

  const start = Math.max(0, idx - 20);
  const end = Math.min(content.length, idx + linkURL.length + 100);
  const surrounding = content.slice(start, end);

  for (const pat of PASSWORD_PATTERNS) {
    const m = surrounding.match(pat);
    if (m) return m[1];
  }

  return extractPasswordFromURL(linkURL).password;
}

function cleanHtmlText(html: string): string {
  let text = html.replace(/<[^>]*>/g, "");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return text.trim();
}

function cleanTitle(title: string): string {
  title = title.trim();
  for (const pat of AD_PATTERNS) {
    title = title.replace(pat, "");
  }
  return title.trim();
}

function deduplicateLinks(links: Link[]): Link[] {
  const map = new Map<string, Link>();
  for (const link of links) {
    const { normalizedURL, password } = extractPasswordFromURL(link.url);
    const newLink: Link = {
      url: link.url,
      type: link.type,
      password: password || link.password || "",
    };

    if (map.has(normalizedURL)) {
      const existing = map.get(normalizedURL)!;
      if (newLink.password && !existing.password) {
        map.set(normalizedURL, newLink);
      } else if (!newLink.password && existing.password) {
        // keep existing
      } else if (newLink.url.length > existing.url.length) {
        map.set(normalizedURL, newLink);
      }
    } else {
      map.set(normalizedURL, newLink);
    }
  }
  return Array.from(map.values());
}

function containsNetworkLink(text: string): boolean {
  return NETWORK_DOMAINS.some((d) => text.includes(d));
}

function isNewWorkTitle(text: string): boolean {
  text = text.trim();
  if (text.length < 3) return false;

  if (/\(\d{4}\)/.test(text)) return true;
  if (/\[[^\]]*\]|【[^\]]*】/.test(text)) return true;

  for (const ind of TITLE_INDICATORS) {
    if (text.includes(ind)) return true;
  }

  if (/【[全\d]+[集\d]*】|【\d+[全集]】|\[\d+[全集]\]|【完结】/.test(text))
    return true;

  for (const prefix of NON_TITLE_PREFIXES) {
    if (text.startsWith(prefix)) return false;
  }

  if (!text.includes("http") && !text.includes("<") && !text.includes(">")) {
    const chars = [...text];
    const textLength = chars.length;

    if (textLength >= 3 && textLength <= 6) {
      let chineseCount = 0;
      for (const ch of chars) {
        const code = ch.codePointAt(0);
        if (code && code >= 0x4e00 && code <= 0x9fff) chineseCount++;
      }
      if (chineseCount / textLength >= 0.8) return true;
    }

    if (/^[A-Za-z]*[^\s]*(?:传|剧|版|之|的|与|和|：|丨|\s)+/.test(text))
      return true;

    if (textLength >= 7 && textLength <= 50) {
      if (/^[\u4e00-\u9fff\w\s\-()（）]+$/.test(text)) return true;
    }
  }

  return false;
}

function isWorkTitleRelevant(title: string, keyword: string): boolean {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/ /g, "")
    .replace(/\./g, "");
  const normalizedKeyword = keyword
    .toLowerCase()
    .replace(/ /g, "")
    .replace(/\./g, "");

  if (normalizedTitle.includes(normalizedKeyword)) return true;
  return false;
}

function isLineTitleRelevant(line: string, keyword: string): boolean {
  const workPattern = /([^丨]+)丨[^：]+：/g;
  let m: RegExpExecArray | null = workPattern.exec(line);
  while (m !== null) {
    const workTitle = m[1].trim();
    if (isWorkTitleRelevant(workTitle, keyword)) return true;
    m = workPattern.exec(line);
  }
  return false;
}

function isSingleLineFormat(lines: string[], keyword: string): boolean {
  let validLineCount = 0;
  let matchingLineCount = 0;

  for (const line of lines) {
    const cleanLine = cleanHtmlText(line);
    if (cleanLine.trim().length < 10) continue;

    if (SINGLE_LINE_PATTERN.test(cleanLine)) {
      validLineCount++;
      if (isLineTitleRelevant(cleanLine, keyword)) {
        matchingLineCount++;
      }
    }
  }

  return validLineCount >= 2 && matchingLineCount > 0;
}

interface SearchResultWithDetail extends SearchResult {
  _detailURL?: string;
}

interface PageResult {
  page: number;
  results: SearchResult[];
}

class PanwikiPlugin extends BasePlugin {
  private currentBaseURL: string;

  constructor() {
    super(PLUGIN_NAME, 3);
    this.currentBaseURL = PRIMARY_BASE_URL;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    this.currentBaseURL = PRIMARY_BASE_URL;

    let firstPageResults: SearchResult[];
    try {
      firstPageResults = await this.searchPage(keyword, 1);
    } catch (err) {
      if (this.currentBaseURL === PRIMARY_BASE_URL) {
        this.currentBaseURL = BACKUP_BASE_URL;
        firstPageResults = await this.searchPage(keyword, 1);
      } else {
        throw err;
      }
    }

    const allResults: SearchResultWithDetail[] = [...firstPageResults];

    if (MAX_PAGES > 1) {
      const pagePromises: Promise<PageResult>[] = [];
      for (let page = 2; page <= MAX_PAGES; page++) {
        const p = page;
        pagePromises.push(
          (async () => {
            await new Promise<void>((r) => setTimeout(r, (p % 3) * 100));
            try {
              return { page: p, results: await this.searchPage(keyword, p) };
            } catch {
              return { page: p, results: [] };
            }
          })(),
        );
      }

      const pageResults = await Promise.all(pagePromises);
      pageResults.sort((a, b) => a.page - b.page);
      for (const pr of pageResults) {
        allResults.push(...pr.results);
      }
    }

    await this.enrichWithDetailLinks(allResults, keyword);

    return filterByKeyword(allResults, keyword);
  }

  async searchPage(
    keyword: string,
    page: number,
  ): Promise<SearchResultWithDetail[]> {
    let searchURL = this.getSearchURL(keyword, page);

    let resp: Response;
    try {
      resp = await fetch(searchURL, {
        method: "GET",
        headers: makeHeaders(this.currentBaseURL),
        redirect: "manual",
      });
    } catch (err) {
      if (this.currentBaseURL === PRIMARY_BASE_URL) {
        this.currentBaseURL = BACKUP_BASE_URL;
        searchURL = this.getSearchURL(keyword, page);
        resp = await fetch(searchURL, {
          method: "GET",
          headers: makeHeaders(this.currentBaseURL),
          redirect: "manual",
        });
      } else {
        throw err;
      }
    }

    const location = resp.headers.get("location") || "";
    if (!location) {
      throw new Error("未获取到重定向URL");
    }

    let resultURL: string;
    if (location.startsWith("http")) {
      resultURL = location;
    } else {
      resultURL = this.currentBaseURL + "/" + location.replace(/^\//, "");
    }

    if (page > 1) {
      const searchidMatch = resultURL.match(/searchid=(\d+)/);
      if (searchidMatch) {
        const searchid = searchidMatch[1];
        resultURL = `${this.currentBaseURL}/search.php?mod=forum&searchid=${searchid}&orderby=lastpost&ascdesc=desc&searchsubmit=yes&page=${page}`;
      }
    }

    const resp2 = await fetchWithRetry(
      resultURL,
      {
        headers: makeHeaders(this.currentBaseURL),
      },
      { timeout: 15000, retries: 2 },
    );

    if (!resp2.ok) {
      throw new Error(`搜索请求返回状态码: ${resp2.status}`);
    }

    const html = await resp2.text();
    const $ = cheerio.load(html);

    return this.extractSearchResults($);
  }

  getSearchURL(keyword: string, page: number): string {
    let url =
      this.currentBaseURL +
      SEARCH_PATH.replace("%s", encodeURIComponent(keyword));
    if (page > 1) {
      url += `&page=${page}`;
    }
    return url;
  }

  extractSearchResults($: cheerio.CheerioAPI): SearchResultWithDetail[] {
    const results: SearchResultWithDetail[] = [];

    $(".slst ul li.pbw").each((i, el) => {
      const s = $(el);
      const result = this.parseSearchResult($, s);
      if (result && result.title) {
        results.push(result);
      }
    });

    return results;
  }

  parseSearchResult(
    $: cheerio.CheerioAPI,
    s: cheerio.Cheerio,
  ): SearchResultWithDetail | null {
    const titleLink = s.find("h3.xs3 a").first();
    const title = cleanTitle(titleLink.text());
    const detailPath = titleLink.attr("href") || "";

    let detailURL = "";
    if (detailPath) {
      if (detailPath.startsWith("http")) {
        detailURL = detailPath;
      } else {
        detailURL = this.currentBaseURL + "/" + detailPath.replace(/^\//, "");
      }
    }

    let content = "";
    s.find("p").each((i, pEl) => {
      if (i === 1) {
        content = $(pEl).text().trim();
      }
    });

    const statsText = s.find("p.xg1").first().text();

    let publishTime = "";
    let author = "";
    let category = "";
    const lastP = s.find("p").last();
    const spans = lastP.find("span");
    if (spans.length >= 3) {
      publishTime = $(spans[0]).text().trim();
      author = $(spans[1]).find("a").text().trim();
      category = $(spans[2]).find("a").text().trim();
    }

    let enrichedContent = content;
    if (author || category) {
      enrichedContent = `${content} | 作者: ${author} | 分类: ${category} | 详情: ${detailURL}`;
    } else if (detailURL) {
      enrichedContent = `${content} | 详情: ${detailURL}`;
    }

    let postID = "";
    if (detailURL) {
      const tidMatch = detailURL.match(/tid=(\d+)/);
      if (tidMatch) postID = tidMatch[1];
    }
    if (!postID) {
      postID = String(Date.now()) + String(Math.floor(Math.random() * 10000));
    }

    const datetime = this.parseTime(publishTime);

    return {
      uniqueId: `${PLUGIN_NAME}-${postID}`,
      title,
      content: enrichedContent,
      links: [],
      channel: "",
      datetime,
      tags: [],
      _detailURL: detailURL,
    };
  }

  parseTime(timeStr: string): string {
    if (!timeStr) return new Date().toISOString();
    timeStr = timeStr.trim();

    const m = timeStr.match(
      /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/,
    );
    if (m) {
      const [, year, month, day, hour, minute, second] = m;
      const d = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second || "0"),
      );
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    return new Date().toISOString();
  }

  async enrichWithDetailLinks(
    results: SearchResultWithDetail[],
    keyword: string,
  ): Promise<void> {
    if (results.length === 0) return;

    const runTask = (index: number) => {
      return (async () => {
        const result = results[index];
        const detailURL =
          this.extractDetailURLFromContent(result.content) ||
          result._detailURL ||
          "";
        if (!detailURL) return;

        await new Promise<void>((r) => setTimeout(r, (index % 3) * 50));

        try {
          const links = await this.fetchDetailPageLinksWithKeyword(
            detailURL,
            keyword,
          );
          if (links.length > 0) {
            result.links = [...result.links, ...links];
          }
        } catch {
          // 忽略单个详情页失败
        }
      })();
    };

    for (let start = 0; start < results.length; start += MAX_CONCURRENCY) {
      const batch: Promise<void>[] = [];
      const end = Math.min(start + MAX_CONCURRENCY, results.length);
      for (let i = start; i < end; i++) {
        batch.push(runTask(i));
      }
      await Promise.all(batch);
    }

    for (const r of results) {
      delete r._detailURL;
    }
  }

  extractDetailURLFromContent(content: string): string {
    const m = content.match(/详情:\s*(https?:\/\/[^\s]+)/);
    return m ? m[1] : "";
  }

  async fetchDetailPageLinksWithKeyword(
    detailURL: string,
    keyword: string,
  ): Promise<Link[]> {
    if (!detailURL) return [];

    const resp = await fetchWithRetry(
      detailURL,
      {
        headers: makeHeaders(this.currentBaseURL),
      },
      { timeout: 15000, retries: 1 },
    );

    if (!resp.ok) return [];

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.extractDetailPageLinksWithFilter($, keyword);
  }

  extractDetailPageLinksWithFilter(
    $: cheerio.CheerioAPI,
    keyword: string,
  ): Link[] {
    let contentArea = $(".t_f[id^='postmessage_']").first();
    if (contentArea.length === 0) {
      contentArea = $(
        '.t_msgfont, .plhin, .message, [id^="postmessage_"]',
      ).first();
    }
    if (contentArea.length === 0) return [];

    const allFoundLinks = this.extractAllLinksDirectly($, contentArea);

    if (allFoundLinks.length <= 4) {
      return allFoundLinks;
    }

    const htmlContent = contentArea.html() || "";
    const lines = htmlContent.split("\n");

    if (isSingleLineFormat(lines, keyword)) {
      return this.extractLinksFromSingleLineFormat(lines, keyword);
    }

    return this.extractLinksWithGrouping(htmlContent, keyword);
  }

  extractAllLinksDirectly(
    $: cheerio.CheerioAPI,
    contentArea: cheerio.Cheerio,
  ): Link[] {
    const links: Link[] = [];

    contentArea.find("a").each((i, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const linkType = determineLinkType(href);
      if (linkType) {
        const password = extractPasswordFromContent(contentArea.text(), href);
        links.push({ url: href, type: linkType as CloudType, password });
      }
    });

    const contentText = contentArea.text();
    const textLinks = extractLinksFromText(contentText);
    links.push(...textLinks);

    return deduplicateLinks(links);
  }

  extractLinksFromSingleLineFormat(lines: string[], keyword: string): Link[] {
    const allLinks: Link[] = [];

    for (const line of lines) {
      const cleanLine = cleanHtmlText(line);
      if (cleanLine.trim().length < 10) continue;

      if (cleanLine.includes("\u4E28") && cleanLine.includes("\uFF1A")) {
        const relevantLinks = this.extractLinksFromSingleLine(
          cleanLine,
          keyword,
        );
        allLinks.push(...relevantLinks);
      }
    }

    return deduplicateLinks(allLinks);
  }

  extractLinksFromSingleLine(line: string, keyword: string): Link[] {
    const results: Link[] = [];

    SINGLE_LINE_EXTRACT.lastIndex = 0;
    let m: RegExpExecArray | null = SINGLE_LINE_EXTRACT.exec(line);
    while (m !== null) {
      const workName = m[1].trim();
      const url = m[3].trim();

      if (isWorkTitleRelevant(workName, keyword)) {
        const linkType = determineLinkType(url);
        if (linkType) {
          const { password } = extractPasswordFromURL(url);
          results.push({ url, type: linkType as CloudType, password });
        }
      }
      m = SINGLE_LINE_EXTRACT.exec(line);
    }

    return results;
  }

  extractLinksWithGrouping(htmlContent: string, keyword: string): Link[] {
    const lines = htmlContent.split("\n");
    const allLinks: Link[] = [];
    let currentGroup: string[] = [];
    let isRelevantGroup = false;

    for (const line of lines) {
      const cleanLine = cleanHtmlText(line);

      if (cleanLine.trim().length < 5) continue;

      const isTitle = isNewWorkTitle(cleanLine);
      if (isTitle) {
        if (currentGroup.length > 0 && isRelevantGroup) {
          const groupLinks = this.extractLinksFromGroup(currentGroup);
          allLinks.push(...groupLinks);
        }

        currentGroup = [line];
        isRelevantGroup = isWorkTitleRelevant(cleanLine, keyword);
      } else {
        if (currentGroup.length > 0) {
          currentGroup.push(line);
        }
      }
    }

    if (currentGroup.length > 0 && isRelevantGroup) {
      const groupLinks = this.extractLinksFromGroup(currentGroup);
      allLinks.push(...groupLinks);
    }

    return deduplicateLinks(allLinks);
  }

  extractLinksFromGroup(group: string[]): Link[] {
    const links: Link[] = [];
    const groupHTML = group.join("\n");
    const $ = cheerio.load("<div>" + groupHTML + "</div>");

    $("a").each((i, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const linkType = determineLinkType(href);
      if (linkType) {
        links.push({ url: href, type: linkType as CloudType, password: "" });
      }
    });

    const text = $.root().text();
    const textLinks = extractLinksFromText(text);
    links.push(...textLinks);

    return links;
  }
}

export default PanwikiPlugin;
