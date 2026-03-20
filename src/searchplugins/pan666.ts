import {
  BasePlugin,
  cleanHTML,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  filterByKeyword,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://pan666.net/api/discussions";
const PAGE_SIZE = 50;

const URL_REGEX = /https?:\/\/[\w.-]+(?:\/[\w\-./?%&=+#]*)?/g;

function generateRandomIP(): string {
  const a = Math.floor(Math.random() * 223) + 1;
  const b = Math.floor(Math.random() * 255);
  const c = Math.floor(Math.random() * 255);
  const d = Math.floor(Math.random() * 254) + 1;
  return `${a}.${b}.${c}.${d}`;
}

function normalizeTextFromHTML(html: string): string {
  if (!html) return "";
  return cleanHTML(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n"),
  );
}

interface LinkInfo {
  url: string;
  type: string;
  lineIdx: number;
}

interface PasswordInfo {
  password: string;
  lineIdx: number;
}

function extractLinksFromText(text: string): Link[] {
  if (!text) return [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const linkInfos: LinkInfo[] = [];
  const passwordInfos: PasswordInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const urls = line.match(URL_REGEX) || [];
    for (const raw of urls) {
      const type = determineCloudType(raw);
      if (type === "others") continue;

      const normalized = raw.replace(/[),.;\]}>"']+$/g, "");
      linkInfos.push({ url: normalized, type, lineIdx: i });
    }

    const pwd = extractPassword(line);
    if (pwd && pwd.length <= 10) {
      passwordInfos.push({ password: pwd, lineIdx: i });
    } else {
      const m = line.match(/访问码[：:]\s*([0-9a-zA-Z]{1,10})/);
      if (m) passwordInfos.push({ password: m[1], lineIdx: i });
    }
  }

  const links: Link[] = [];
  const seen = new Set<string>();

  for (const info of linkInfos) {
    const key = `${info.type}|${info.url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let password = "";

    const urlPwd = (() => {
      const m = info.url.match(/[?&](?:pwd|password|passcode|code)=([^&#]+)/i);
      return m ? decodeURIComponent(m[1]) : "";
    })();
    if (urlPwd) password = urlPwd;

    if (!password && passwordInfos.length) {
      let best: PasswordInfo | null = null;
      let bestDist = Infinity;
      for (const pw of passwordInfos) {
        const dist = Math.abs(pw.lineIdx - info.lineIdx);
        if (dist < bestDist) {
          bestDist = dist;
          best = pw;
        }
      }
      if (best && bestDist <= 3) password = best.password;
    }

    links.push({ type: info.type as CloudType, url: info.url, password });
  }

  return links;
}

interface APIPage {
  data?: APIDiscussion[];
  included?: APIPost[];
}

interface APIDiscussion {
  id?: string;
  attributes?: {
    title?: string;
    createdAt?: string;
  };
  relationships?: {
    mostRelevantPost?: {
      data?: {
        id?: string;
      };
    };
  };
}

interface APIPost {
  id?: string;
  attributes?: {
    contentHtml?: string;
    contentHTML?: string;
  };
}

class Pan666Plugin extends BasePlugin {
  constructor() {
    super("pan666", 3);
  }

  async _fetchPage(keyword: string, offset: number): Promise<APIPage | null> {
    const apiURL =
      `${BASE_URL}?filter[q]=${encodeURIComponent(keyword)}` +
      `&include=mostRelevantPost&page[offset]=${offset}&page[limit]=${PAGE_SIZE}`;

    const resp = await fetchWithRetry(
      apiURL,
      {
        headers: {
          "User-Agent": getRandomUA(),
          "X-Forwarded-For": generateRandomIP(),
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
      },
      { timeout: 10000, retries: 2 },
    );

    const data: APIPage = await resp.json();
    return data;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    const offsets = [0, PAGE_SIZE];

    const pages = await Promise.all(
      offsets.map(async (offset, idx) => {
        if (idx > 0) {
          await new Promise<void>((r) =>
            setTimeout(r, 100 + Math.floor(Math.random() * 900)),
          );
        }
        try {
          return await this._fetchPage(keyword, offset);
        } catch (e) {
          return null;
        }
      }),
    );

    const results: SearchResult[] = [];

    for (const page of pages) {
      if (!page || !Array.isArray(page.data) || !Array.isArray(page.included))
        continue;

      const postMap = new Map<string, APIPost>();
      for (const post of page.included) {
        if (post && post.id) postMap.set(String(post.id), post);
      }

      for (const discussion of page.data) {
        const discussionId =
          discussion && discussion.id ? String(discussion.id) : "";
        const title = discussion?.attributes?.title || "";
        const createdAt = discussion?.attributes?.createdAt || "";
        const postId = discussion?.relationships?.mostRelevantPost?.data?.id;
        if (!discussionId || !title || !postId) continue;

        const post = postMap.get(String(postId));
        const contentHTML =
          post?.attributes?.contentHtml || post?.attributes?.contentHTML || "";

        const text = normalizeTextFromHTML(contentHTML);
        const links = extractLinksFromText(text);
        if (!links.length) continue;

        results.push({
          uniqueId: `pan666-${discussionId}`,
          title,
          content: "",
          links,
          datetime: createdAt,
          tags: [],
          channel: "",
        });
      }
    }

    results.sort((a, b) => {
      const ta = Date.parse(a.datetime || "") || 0;
      const tb = Date.parse(b.datetime || "") || 0;
      return tb - ta;
    });

    return filterByKeyword(results, keyword);
  }
}

export default Pan666Plugin;
