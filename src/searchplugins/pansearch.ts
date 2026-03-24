import {
  BasePlugin,
  cleanHTML,
  deduplicateResults,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  filterByKeyword,
  getRandomUA,
} from "./base";
import type { CloudType, SearchResult } from "./types";

const WEBSITE_URL = "https://www.pansearch.me/search";
const BASE_URL_TEMPLATE = "https://www.pansearch.me/_next/data/%s/search.json";

const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 10;

const BUILD_ID_REGEX = /"buildId":"([^"]+)"/;
const NEXT_DATA_REGEX =
  /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/;

let buildIdCache = "";
let buildIdCacheAt = 0;
const BUILD_ID_TTL_MS = 30 * 60 * 1000;

function formatBaseURL(buildId: string): string {
  return BASE_URL_TEMPLATE.replace("%s", buildId);
}

function extractBuildIdFromHTML(html: string): string {
  if (!html) return "";

  const m = BUILD_ID_REGEX.exec(html);
  if (m && m[1]) return m[1];

  const m2 = NEXT_DATA_REGEX.exec(html);
  if (m2 && m2[1]) {
    try {
      const obj = JSON.parse(m2[1]);
      if (obj && typeof obj.buildId === "string" && obj.buildId)
        return obj.buildId;
    } catch {
      // ignore
    }
  }

  return "";
}

interface LinkInfo {
  url: string;
  password: string;
}

function extractLinkAndPasswordFromContent(content: string): LinkInfo {
  const out: LinkInfo = { url: "", password: "" };
  if (!content) return out;

  const hrefM = content.match(/href\s*=\s*"([^"]+)"/i);
  if (hrefM && hrefM[1]) out.url = hrefM[1];

  if (!out.url) {
    const urlM = content.match(/https?:\/\/[^\s"'<>]+/);
    if (urlM) out.url = urlM[0];
  }

  if (out.url) {
    const m = out.url.match(/[?&](?:pwd|password|passcode|code)=([^&#]+)/i);
    if (m && m[1]) {
      try {
        out.password = decodeURIComponent(m[1]);
      } catch {
        out.password = m[1];
      }
    }
  }

  if (!out.password) out.password = extractPassword(cleanHTML(content));
  return out;
}

function extractTitleFromContent(content: string, keyword: string): string {
  const text = cleanHTML((content || "").replace(/<br\s*\/?\s*>/gi, "\n"));
  const idx = text.indexOf("名称：");
  if (idx >= 0) {
    const rest = text.slice(idx + "名称：".length);
    const line = rest.split(/\r?\n/)[0].trim();
    if (line) return line;
  }
  return keyword;
}

interface APIError extends Error {
  code?: number;
}

interface PageProps {
  data?: {
    data?: APIItem[];
    total?: number;
  };
}

interface APIResponse {
  pageProps?: PageProps;
}

interface APIItem {
  id?: number | string;
  content?: string;
  pan?: string;
  time?: string;
}

class PansearchPlugin extends BasePlugin {
  constructor() {
    super("pansearch", 3);
  }

  async _getBuildId(): Promise<string> {
    const now = Date.now();
    if (buildIdCache && now - buildIdCacheAt < BUILD_ID_TTL_MS)
      return buildIdCache;

    const resp = await fetchWithRetry(
      WEBSITE_URL,
      {
        headers: {
          "User-Agent": getRandomUA(),
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
        },
      },
      { timeout: 30000, retries: 2 },
    );

    const html = await resp.text();
    const buildId = extractBuildIdFromHTML(html);
    if (buildId) {
      buildIdCache = buildId;
      buildIdCacheAt = now;
    }
    return buildId;
  }

  async _fetchPage(
    keyword: string,
    offset: number,
    baseURL: string,
  ): Promise<APIResponse> {
    const apiURL = `${baseURL}?keyword=${encodeURIComponent(keyword)}&offset=${offset}`;

    const resp = await fetchWithRetry(
      apiURL,
      {
        headers: {
          "User-Agent": getRandomUA(),
          Referer: "https://www.pansearch.me/",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      },
      { timeout: 30000, retries: 1 },
    );

    if (resp.status === 404) {
      const err: APIError = new Error("404 Not Found (buildId may be expired)");
      err.code = 404;
      throw err;
    }

    const json: APIResponse = await resp.json();
    return json;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const maxPages = Number.isFinite(ext.maxPages)
      ? Math.max(1, Math.floor(ext.maxPages as number))
      : DEFAULT_MAX_PAGES;

    let buildId = await this._getBuildId();
    if (!buildId) return [];

    let baseURL = formatBaseURL(buildId);

    let first: APIResponse;
    try {
      first = await this._fetchPage(keyword, 0, baseURL);
    } catch (e) {
      const error = e as APIError;
      if (
        error &&
        (error.code === 404 || String(error.message || "").includes("404"))
      ) {
        buildIdCache = "";
        buildIdCacheAt = 0;
        buildId = await this._getBuildId();
        if (!buildId) return [];
        baseURL = formatBaseURL(buildId);
        first = await this._fetchPage(keyword, 0, baseURL);
      } else {
        throw e;
      }
    }

    const firstItems = first?.pageProps?.data?.data || [];
    const total = Number(first?.pageProps?.data?.total || 0);

    let items: APIItem[] = Array.isArray(firstItems) ? firstItems.slice() : [];

    const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
    const needPages = Math.min(maxPages, Math.max(1, totalPages));

    const offsets: number[] = [];
    for (let p = 1; p < needPages; p++) offsets.push(p * PAGE_SIZE);

    const morePages = await Promise.all(
      offsets.map(async (offset) => {
        try {
          const data = await this._fetchPage(keyword, offset, baseURL);
          return data?.pageProps?.data?.data || [];
        } catch (e) {
          return [];
        }
      }),
    );

    for (const arr of morePages) {
      if (Array.isArray(arr)) items.push(...arr);
    }

    const itemMap = new Map<string, APIItem>();
    for (const it of items) {
      if (it && (typeof it.id === "number" || typeof it.id === "string")) {
        itemMap.set(String(it.id), it);
      }
    }
    items = Array.from(itemMap.values());

    const results: SearchResult[] = [];
    for (const it of items) {
      const id = it?.id;
      const content = it?.content || "";
      const pan = it?.pan || "";
      const time = it?.time || "";

      const linkInfo = extractLinkAndPasswordFromContent(content);
      if (!linkInfo.url) continue;

      let linkType = pan;
      if (linkType === "aliyundrive") linkType = "aliyun";
      if (!linkType || linkType === "unknown")
        linkType = determineCloudType(linkInfo.url);

      const type = linkType || determineCloudType(linkInfo.url);
      if (type === "others") continue;

      results.push({
        uniqueId: `pansearch-${id}`,
        title: extractTitleFromContent(content, keyword),
        content: cleanHTML(content),
        links: [
          {
            type: type as CloudType,
            url: linkInfo.url,
            password: linkInfo.password || "",
          },
        ],
        datetime: time,
        tags: [],
        channel: "",
      });
    }

    return filterByKeyword(deduplicateResults(results), keyword);
  }
}

export default PansearchPlugin;
