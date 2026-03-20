import {
  BasePlugin,
  fetchWithRetry,
  filterByKeyword,
  generateUniqueID,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const BASE_URL = "https://panyq.com";
const MAX_PAGES = 3;
const DEFAULT_TIMEOUT = 15000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const SEC_CH_UA =
  '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"';

const ACTION_ID_KEYS = [
  "credential_action_id",
  "intermediate_action_id",
  "final_link_action_id",
];

interface ActionIDCache {
  [key: string]: string;
}

let actionIDCache: ActionIDCache = {};

interface UnicodeReplacement extends Array<RegExp | string> {
  0: RegExp;
  1: string;
}

function cleanEscapedHTML(text: string): string {
  if (!text) return "";
  let result = text;

  const unicodeReplacements: UnicodeReplacement[] = [
    [/\\u003C\/?mark\\u003E/gi, ""],
    [/\\u003C\/?b\\u003E/gi, ""],
    [/\\u003C\/?em\\u003E/gi, ""],
    [/\\u003C\/?strong\\u003E/gi, ""],
    [/\\u003C\/?i\\u003E/gi, ""],
    [/\\u003C\/?u\\u003E/gi, ""],
    [/\\u003Cbr\s*\/?\s*\\u003E/gi, " "],
  ];

  for (const [pat, rep] of unicodeReplacements) {
    result = result.replace(pat, rep);
  }

  const htmlReplacements: UnicodeReplacement[] = [
    [/<\/?mark>/gi, ""],
    [/<\/?b>/gi, ""],
    [/<\/?em>/gi, ""],
    [/<\/?strong>/gi, ""],
    [/<\/?i>/gi, ""],
    [/<\/?u>/gi, ""],
    [/<br\s*\/?>/gi, " "],
  ];

  for (const [pat, rep] of htmlReplacements) {
    result = result.replace(pat, rep);
  }

  return result;
}

function extractTitle(desc: string): string {
  const cleanDesc = cleanEscapedHTML(desc);

  const bookMatch = cleanDesc.match(/《([^》]+)》/);
  if (bookMatch) return bookMatch[1];

  const bracketMatch = cleanDesc.match(/【([^】]+)】/);
  if (bracketMatch) return bracketMatch[1];

  const parts = cleanDesc.split("✔");
  if (parts.length > 0 && parts[0].trim().length > 0) {
    return parts[0].trim();
  }

  if (cleanDesc.length > 30) {
    return cleanDesc.slice(0, 30).trim() + "...";
  }

  return cleanDesc.trim();
}

function determineLinkType(url: string): string {
  if (!url) return "others";
  const lower = url.toLowerCase();

  if (lower.includes("pan.baidu.com")) return "baidu";
  if (lower.includes("alipan.com") || lower.includes("aliyundrive.com"))
    return "aliyun";
  if (lower.includes("pan.xunlei.com")) return "xunlei";
  if (lower.includes("cloud.189.cn")) return "tianyi";
  if (lower.includes("caiyun.139.com") || lower.includes("yun.139.com"))
    return "mobile";
  if (lower.includes("pan.quark.cn")) return "quark";
  if (lower.includes("115.com")) return "115";
  if (lower.includes("weiyun.com")) return "weiyun";
  if (lower.includes("lanzou")) return "lanzou";
  if (lower.includes("123pan.com")) return "123";
  if (lower.includes("drive.uc.cn")) return "uc";
  if (lower.includes("mypikpak.com")) return "pikpak";
  if (lower.startsWith("magnet:")) return "magnet";
  if (lower.startsWith("ed2k:")) return "ed2k";
  return "others";
}

function extractLinkPassword(url: string, linkType: string): string {
  if (!url) return "";

  if (linkType === "baidu") {
    const m = url.match(/[?&]pwd=([^&#]+)/);
    if (m) {
      const pwd = m[1];
      return pwd.length >= 4 ? pwd.slice(0, 4) : pwd;
    }
  }

  if (linkType === "aliyun") {
    const m = url.match(/[?&]password=([^&#]+)/);
    if (m) return m[1];
  }

  return "";
}

function commonHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "User-Agent": UA,
    "sec-ch-ua": SEC_CH_UA,
    Origin: BASE_URL,
    ...extra,
  };
}

interface Credentials {
  sign: string;
  sha: string;
  hash: string;
}

interface SearchResultHits {
  hits: APIHit[];
  maxPageNum: number;
}

interface APIHit {
  eid?: string;
  desc?: string;
  size_str?: string;
}

interface ActionIDs {
  [key: string]: string;
}

class PanyqPlugin extends BasePlugin {
  constructor() {
    super("panyq", 2);
  }

  async getOrDiscoverActionIDs(): Promise<ActionIDs> {
    if (Object.keys(actionIDCache).length >= ACTION_ID_KEYS.length) {
      const allPresent = ACTION_ID_KEYS.every((k) => actionIDCache[k]);
      if (allPresent) return { ...actionIDCache };
    }

    return this.discoverActionIDs();
  }

  async findPotentialActionIDs(): Promise<string[]> {
    const resp = await fetchWithRetry(
      BASE_URL,
      {
        headers: commonHeaders(),
      },
      { timeout: DEFAULT_TIMEOUT, retries: 2 },
    );

    const html = await resp.text();

    const jsRegex = /<script src="(\/_next\/static\/[^"]+\.js)"/g;
    const jsFiles: string[] = [];
    let m: RegExpExecArray | null = jsRegex.exec(html);
    while (m !== null) {
      jsFiles.push(m[1]);
      m = jsRegex.exec(html);
    }

    if (jsFiles.length === 0) {
      throw new Error("No JS files found on homepage");
    }

    const idSet = new Set<string>();
    const idRegex = /["']([a-f0-9]{40})["']/g;

    const fetchPromises = jsFiles.map(async (jsPath) => {
      try {
        const jsURL = BASE_URL + jsPath;
        const jsResp = await fetchWithRetry(
          jsURL,
          {
            headers: commonHeaders({
              Referer: BASE_URL,
            }),
          },
          { timeout: DEFAULT_TIMEOUT, retries: 1 },
        );
        const jsBody = await jsResp.text();

        let idMatch: RegExpExecArray | null = idRegex.exec(jsBody);
        while (idMatch !== null) {
          idSet.add(idMatch[1]);
          idMatch = idRegex.exec(jsBody);
        }
        idRegex.lastIndex = 0;
      } catch {
        // Ignore individual JS fetch failures
      }
    });

    await Promise.all(fetchPromises);

    return Array.from(idSet);
  }

  async getCredentials(query: string, actionID: string): Promise<Credentials> {
    const payload = JSON.stringify([{ cat: "all", query, pageNum: 1 }]);

    const resp = await fetchWithRetry(
      BASE_URL,
      {
        method: "POST",
        headers: commonHeaders({
          "Content-Type": "text/plain;charset=UTF-8",
          "next-action": actionID,
          Referer: BASE_URL,
        }),
        body: payload,
      },
      { timeout: DEFAULT_TIMEOUT, retries: 0 },
    );

    const body = await resp.text();

    const signMatch = body.match(/"sign":"([^"]+)"/);
    const shaMatch = body.match(/"sha":"([a-f0-9]{64})"/);
    const hashMatch = body.match(/"hash","([^"]+)"/);

    if (!signMatch || !shaMatch || !hashMatch) {
      throw new Error("Failed to extract credentials");
    }

    return {
      sign: signMatch[1],
      sha: shaMatch[1],
      hash: hashMatch[1],
    };
  }

  async getSearchResults(
    sign: string,
    pageNum: number,
  ): Promise<SearchResultHits> {
    const searchURL = `${BASE_URL}/api/search?sign=${sign}&page=${pageNum}`;

    const headers = commonHeaders({
      Referer: BASE_URL,
    });

    if (actionIDCache[ACTION_ID_KEYS[0]]) {
      headers["next-action"] = actionIDCache[ACTION_ID_KEYS[0]];
    }

    const resp = await fetchWithRetry(
      searchURL,
      {
        headers,
      },
      { timeout: DEFAULT_TIMEOUT, retries: 0 },
    );

    const data = await resp.json();

    const hits: APIHit[] = (data && data.data && data.data.hits) || [];
    const maxPageNum: number = (data && data.data && data.data.maxPageNum) || 0;

    return { hits, maxPageNum };
  }

  async performIntermediateStep(
    actionID: string,
    hashVal: string,
    shaVal: string,
    eid: string,
  ): Promise<void> {
    const intermediateURL = `${BASE_URL}/search/${hashVal}`;

    const routerStateTree = [
      "",
      {
        children: [
          "search",
          {
            children: [
              ["hash", hashVal, "d"],
              {
                children: ["__PAGE__", {}, `/search/${hashVal}`, "refresh"],
              },
            ],
          },
        ],
      },
      null,
      null,
      true,
    ];

    const routerStateTreeEncoded = encodeURIComponent(
      JSON.stringify(routerStateTree),
    );
    const payload = JSON.stringify([{ eid, sha: shaVal, page_num: "1" }]);

    const resp = await fetchWithRetry(
      intermediateURL,
      {
        method: "POST",
        headers: commonHeaders({
          "Content-Type": "text/plain;charset=UTF-8",
          "next-action": actionID,
          Referer: intermediateURL,
          "next-router-state-tree": routerStateTreeEncoded,
        }),
        body: payload,
      },
      { timeout: DEFAULT_TIMEOUT, retries: 0 },
    );

    if (!resp.ok) {
      throw new Error(`Intermediate step failed with status ${resp.status}`);
    }
  }

  async getRawFinalLinkResponse(
    actionID: string,
    eid: string,
  ): Promise<string> {
    const finalURL = `${BASE_URL}/go/${eid}`;

    const routerStateTree = [
      "",
      {
        children: [
          "go",
          {
            children: [
              ["eid", eid, "d"],
              {
                children: ["__PAGE__", {}, `/go/${eid}`, "refresh"],
              },
            ],
          },
        ],
      },
      null,
      null,
      true,
    ];

    const routerStateTreeEncoded = encodeURIComponent(
      JSON.stringify(routerStateTree),
    );
    const payload = JSON.stringify([{ eid }]);

    const resp = await fetchWithRetry(
      finalURL,
      {
        method: "POST",
        headers: commonHeaders({
          "Content-Type": "text/plain;charset=UTF-8",
          "next-action": actionID,
          Referer: finalURL,
          "next-router-state-tree": routerStateTreeEncoded,
        }),
        body: payload,
      },
      { timeout: DEFAULT_TIMEOUT, retries: 0 },
    );

    if (!resp.ok) {
      throw new Error(`Final link request failed with status ${resp.status}`);
    }

    return resp.text();
  }

  async getFinalLink(actionID: string, eid: string): Promise<string> {
    const responseText = await this.getRawFinalLinkResponse(actionID, eid);

    const lines = responseText.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed) && parsed.length > 1) {
          const linkObj = parsed[parsed.length - 1];
          if (linkObj && typeof linkObj === "object" && linkObj.url) {
            return linkObj.url;
          }
          if (parsed[1] && typeof parsed[1] === "object" && parsed[1].url) {
            return parsed[1].url;
          }
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    const urlMatch = responseText.match(
      /(https?:\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/,
    );
    if (urlMatch) {
      return urlMatch[0];
    }

    return "";
  }

  async validateCredentialID(actionID: string): Promise<boolean> {
    try {
      await this.getCredentials("test", actionID);
      return true;
    } catch {
      return false;
    }
  }

  async validateIntermediateID(
    actionID: string,
    testHash: string,
    testSha: string,
  ): Promise<boolean> {
    try {
      await this.performIntermediateStep(
        actionID,
        testHash,
        testSha,
        "fake_eid_for_validation",
      );
      return true;
    } catch {
      return false;
    }
  }

  async validateFinalLinkID(
    actionID: string,
    testEID: string,
  ): Promise<boolean> {
    try {
      const responseText = await this.getRawFinalLinkResponse(
        actionID,
        testEID,
      );
      const keywords = ["http", "magnet", "aliyundrive", '"url"'];
      for (const kw of keywords) {
        if (responseText.includes(kw)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async discoverActionIDs(): Promise<ActionIDs> {
    const potentialIDs = await this.findPotentialActionIDs();
    if (potentialIDs.length === 0) {
      throw new Error("No potential Action IDs found");
    }

    const finalIDs: ActionIDs = {};

    const credResults = await Promise.allSettled(
      potentialIDs.map(async (id) => {
        const valid = await this.validateCredentialID(id);
        if (valid) return id;
        throw new Error("invalid");
      }),
    );

    let credentialID: string | null = null;
    for (const r of credResults) {
      if (r.status === "fulfilled" && r.value) {
        credentialID = r.value;
        break;
      }
    }

    if (!credentialID) {
      throw new Error("Failed to validate credential_action_id");
    }
    finalIDs[ACTION_ID_KEYS[0]] = credentialID;

    const testCreds = await this.getCredentials("test", credentialID);

    let remainingIDs = potentialIDs.filter((id) => id !== credentialID);

    let intermediateID: string | null = null;
    for (let i = remainingIDs.length - 1; i >= 0; i--) {
      const valid = await this.validateIntermediateID(
        remainingIDs[i],
        testCreds.hash,
        testCreds.sha,
      );
      if (valid) {
        intermediateID = remainingIDs[i];
        break;
      }
    }

    if (!intermediateID) {
      throw new Error("Failed to validate intermediate_action_id");
    }
    finalIDs[ACTION_ID_KEYS[1]] = intermediateID;

    const { hits: testHits } = await this.getSearchResults(testCreds.sign, 1);
    if (testHits.length === 0) {
      throw new Error("No test search results for final link validation");
    }
    const testEID = testHits[0].eid || "";

    remainingIDs = remainingIDs.filter((id) => id !== intermediateID);

    let finalLinkID: string | null = null;
    for (const id of remainingIDs) {
      try {
        await this.performIntermediateStep(
          intermediateID,
          testCreds.hash,
          testCreds.sha,
          testEID,
        );
      } catch {
        continue;
      }

      const valid = await this.validateFinalLinkID(id, testEID);
      if (valid) {
        finalLinkID = id;
        break;
      }
    }

    if (
      !finalLinkID &&
      remainingIDs.length === 1 &&
      potentialIDs.length === 3
    ) {
      const oldInterID = finalIDs[ACTION_ID_KEYS[1]];
      const candidateInterID = remainingIDs[0];

      try {
        await this.performIntermediateStep(
          candidateInterID,
          testCreds.hash,
          testCreds.sha,
          testEID,
        );
        const valid = await this.validateFinalLinkID(oldInterID, testEID);
        if (valid) {
          finalIDs[ACTION_ID_KEYS[1]] = candidateInterID;
          finalLinkID = oldInterID;
        }
      } catch {
        // Swap failed
      }
    }

    if (!finalLinkID) {
      throw new Error("Failed to validate final_link_action_id");
    }
    finalIDs[ACTION_ID_KEYS[2]] = finalLinkID;

    actionIDCache = { ...finalIDs };

    return finalIDs;
  }

  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    let actionIDs: ActionIDs;
    try {
      actionIDs = await this.getOrDiscoverActionIDs();
    } catch {
      return [];
    }

    let credentials: Credentials;
    try {
      credentials = await this.getCredentials(
        keyword,
        actionIDs[ACTION_ID_KEYS[0]],
      );
    } catch {
      try {
        actionIDCache = {};
        actionIDs = await this.discoverActionIDs();
        credentials = await this.getCredentials(
          keyword,
          actionIDs[ACTION_ID_KEYS[0]],
        );
      } catch {
        return [];
      }
    }

    let allHits: APIHit[] = [];
    let maxPageNum = 0;
    try {
      const firstPage = await this.getSearchResults(credentials.sign, 1);
      allHits = firstPage.hits || [];
      maxPageNum = firstPage.maxPageNum || 0;
    } catch {
      return [];
    }

    if (allHits.length === 0) return [];

    if (maxPageNum > 1) {
      const pagesToFetch = Math.min(maxPageNum, MAX_PAGES);
      const pagePromises: Promise<SearchResultHits>[] = [];
      for (let page = 2; page <= pagesToFetch; page++) {
        pagePromises.push(
          this.getSearchResults(credentials.sign, page).catch(() => ({
            hits: [],
            maxPageNum: 0,
          })),
        );
      }
      const additionalPages = await Promise.all(pagePromises);
      for (const page of additionalPages) {
        if (page.hits && page.hits.length > 0) {
          allHits = allHits.concat(page.hits);
        }
      }
    }

    const processResults = await Promise.allSettled(
      allHits.map(async (hit, index) => {
        const { eid, desc, size_str } = hit;
        if (!eid) return null;

        try {
          await this.performIntermediateStep(
            actionIDs[ACTION_ID_KEYS[1]],
            credentials.hash,
            credentials.sha,
            eid,
          );
        } catch {
          return null;
        }

        let finalLink: string;
        try {
          finalLink = await this.getFinalLink(
            actionIDs[ACTION_ID_KEYS[2]],
            eid,
          );
        } catch {
          return null;
        }

        if (!finalLink) return null;

        const linkType = determineLinkType(finalLink);
        const password = extractLinkPassword(finalLink, linkType);
        const title = extractTitle(desc || "");
        const cleanedDesc = cleanEscapedHTML(desc || "");

        return {
          uniqueId: generateUniqueID("panyq", eid),
          title: cleanEscapedHTML(title),
          content: cleanedDesc + (size_str ? ` [${size_str}]` : ""),
          links: [
            {
              type: linkType as CloudType,
              url: finalLink,
              password,
            },
          ],
          channel: "",
          datetime: "",
        };
      }),
    );

    const results: SearchResult[] = [];
    for (const r of processResults) {
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      }
    }

    return filterByKeyword(results, keyword);
  }
}

export default PanyqPlugin;
