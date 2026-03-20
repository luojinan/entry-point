import cheerio from "cheerio";
import {
  BasePlugin,
  extractPassword,
  fetchWithRetry,
  filterByKeyword,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const SEARCH_URL_TEMPLATE = "https://www.91panta.cn/search?keyword=%s";
const THREAD_URL_TEMPLATE = "https://www.91panta.cn/thread?topicId=%s";

const TOPIC_ID_REGEX = /topicId=(\d+)/;
const YEAR_REGEX = /\(([0-9]{4})\)/;
const POST_TIME_REGEX = /发表时间：\s*([^\n\r]+)/;

const NET_DISK_DOMAINS = [
  "pan.baidu.com",
  "pan.quark.cn",
  "aliyundrive.com",
  "alipan.com",
  "pan.xunlei.com",
  "cloud.189.cn",
  "caiyun.139.com",
  "www.caiyun.139.com",
  "drive.uc.cn",
  "115.com",
  "mypikpak.com",
  "123pan.com",
];

const NET_DISK_PATTERNS = [
  /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?/g,
  /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/g,
  /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9a-zA-Z]+/g,
  /https?:\/\/alipan\.com\/s\/[0-9a-zA-Z]+/g,
  /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?#?/g,
  /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/g,
  /https?:\/\/(?:www\.)?caiyun\.139\.com\/(?:m|w)\/i\?[0-9a-zA-Z]+(?:\?pwd=[0-9a-zA-Z]+)?/g,
  /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(?:\?[^"'\s]*)?/g,
  /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/g,
  /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/g,
  /https?:\/\/www\.123pan\.com\/s\/[0-9a-zA-Z]+/g,
];

function determineLinkType(url: string): string {
  const u = (url || "").toLowerCase();
  if (u.includes("pan.quark.cn")) return "quark";
  if (u.includes("drive.uc.cn")) return "uc";
  if (u.includes("pan.baidu.com")) return "baidu";
  if (u.includes("aliyundrive.com") || u.includes("alipan.com"))
    return "aliyun";
  if (u.includes("pan.xunlei.com")) return "xunlei";
  if (u.includes("cloud.189.cn")) return "tianyi";
  if (u.includes("caiyun.139.com")) return "mobile";
  if (u.includes("115.com")) return "115";
  if (u.includes("123pan.com")) return "123";
  if (u.includes("mypikpak.com")) return "pikpak";
  return "others";
}

function hasAnyNetDiskDomain(text: string): boolean {
  const t = (text || "").toLowerCase();
  return NET_DISK_DOMAINS.some((d) => t.includes(d));
}

function extractPwdFromURL(url: string): string {
  const m = (url || "").match(/[?&]pwd=([0-9a-zA-Z]+)/);
  return m ? m[1] : "";
}

function normalizeURL(raw: string): string {
  return (raw || "").replace(/[),.;\]}>"']+$/g, "").trim();
}

function extractLinksFromText(text: string, yearFromTitle = ""): Link[] {
  if (!text || !hasAnyNetDiskDomain(text)) return [];

  const links: Link[] = [];
  const seen = new Set<string>();

  for (const re of NET_DISK_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
      const raw = normalizeURL(m[0]);
      if (!raw) {
        m = re.exec(text);
        continue;
      }

      const type = determineLinkType(raw);
      if (type === "others") {
        m = re.exec(text);
        continue;
      }

      const key = `${type}|${raw}`;
      if (seen.has(key)) {
        m = re.exec(text);
        continue;
      }
      seen.add(key);

      let password = extractPwdFromURL(raw);

      if (!password) {
        const start = Math.max(0, m.index - 120);
        const end = Math.min(text.length, m.index + raw.length + 160);
        const ctx = text.slice(start, end);
        password = extractPassword(ctx);

        if (
          !password &&
          yearFromTitle &&
          /提取码|密码|pwd|验证码|口令/.test(ctx)
        ) {
          password = yearFromTitle;
        }
      }

      links.push({
        type: type as CloudType,
        url: raw,
        password: password || "",
      });
      m = re.exec(text);
    }
  }

  return links;
}

function extractLinksFromCheerio(
  $: cheerio.CheerioAPI,
  root: cheerio.Element,
  yearFromTitle = "",
): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();

  $(root)
    .find('a[href^="http"]')
    .each((_, a) => {
      const href = normalizeURL($(a).attr("href") || "");
      if (!href) return;
      if (!hasAnyNetDiskDomain(href)) return;

      const type = determineLinkType(href);
      if (type === "others") return;

      const key = `${type}|${href}`;
      if (seen.has(key)) return;
      seen.add(key);

      let password = extractPwdFromURL(href);
      if (!password) {
        const surroundingText =
          ($(a).text() || "") +
          " " +
          ($(a).parent().text() || "") +
          " " +
          ($(root).text() || "");
        password = extractPassword(surroundingText);
        if (
          !password &&
          yearFromTitle &&
          /提取码|密码|pwd|验证码|口令/.test(surroundingText)
        ) {
          password = yearFromTitle;
        }
      }

      links.push({
        type: type as CloudType,
        url: href,
        password: password || "",
      });
    });

  const html = $(root).html() || "";
  const text = (html || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const more = extractLinksFromText(text, yearFromTitle);
  for (const l of more) {
    const key = `${l.type}|${l.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(l);
  }

  return links;
}

function parsePostTime(text: string): string {
  const m = POST_TIME_REGEX.exec(text || "");
  if (!m || !m[1]) return "";
  const str = m[1].trim();
  const d = new Date(str.replace(/-/g, "-"));
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString();
}

interface RawItem {
  el: cheerio.Element;
  topicId: string;
  title: string;
  summary: string;
  datetime: string;
  yearFromTitle: string;
}

class PantaPlugin extends BasePlugin {
  constructor() {
    super("panta", 1);
  }

  _getHeaders(referer: string): Record<string, string> {
    return {
      "User-Agent": getRandomUA(),
      Referer: referer || "https://www.91panta.cn/index",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
    };
  }

  async _fetchThreadLinks(
    topicId: string,
    yearFromTitle: string,
  ): Promise<Link[]> {
    const url = THREAD_URL_TEMPLATE.replace("%s", topicId);
    try {
      const resp = await fetchWithRetry(
        url,
        {
          headers: this._getHeaders("https://www.91panta.cn/index"),
        },
        { timeout: 8000, retries: 2 },
      );

      const html = await resp.text();
      const $ = cheerio.load(html);

      const links: Link[] = [];
      const seen = new Set<string>();

      $("div.topicContent").each((_, el) => {
        const extracted = extractLinksFromCheerio($, el, yearFromTitle);
        for (const l of extracted) {
          const key = `${l.type}|${l.url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          links.push(l);
        }
      });

      return links;
    } catch {
      return [];
    }
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const searchURL = SEARCH_URL_TEMPLATE.replace(
      "%s",
      encodeURIComponent(keyword),
    );

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers: this._getHeaders("https://www.91panta.cn/index"),
      },
      { timeout: 8000, retries: 2 },
    );

    const html = await resp.text();
    const $ = cheerio.load(html);

    const rawItems: RawItem[] = [];
    $("div.topicItem").each((_, el) => {
      const a = $(el).find("a[href^='thread?topicId=']").first();
      const href = a.attr("href") || "";
      const m = TOPIC_ID_REGEX.exec(href);
      if (!m) return;
      const topicId = m[1];

      const title = (a.text() || "").trim();
      const summary = ($(el).find("h2.summary").text() || "").trim();

      const postTimeText = ($(el).find("span.postTime").text() || "").trim();
      const datetime = parsePostTime(postTimeText);

      const yearMatch = YEAR_REGEX.exec(title);
      const yearFromTitle = yearMatch ? yearMatch[1] : "";

      rawItems.push({ el, topicId, title, summary, datetime, yearFromTitle });
    });

    const results = await Promise.all(
      rawItems.map(async (item) => {
        let links = extractLinksFromCheerio($, item.el, item.yearFromTitle);

        if (!links.length) {
          links = await this._fetchThreadLinks(
            item.topicId,
            item.yearFromTitle,
          );
        }

        if (!links.length) return null;

        return {
          uniqueId: `panta-${item.topicId}`,
          title: item.title,
          content: item.summary,
          links,
          datetime: item.datetime,
          tags: ["panta"],
          channel: "",
        };
      }),
    );

    return filterByKeyword(
      results.filter((r): r is SearchResult => r !== null),
      keyword,
    );
  }
}

export default PantaPlugin;
