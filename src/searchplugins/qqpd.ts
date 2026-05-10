import fs from "fs";
import path from "path";

import {
  BasePlugin,
  cleanHTML,
  extractPassword,
  fetchWithRetry,
  generateUniqueID,
  getRandomUA,
} from "./base";
import type { CloudType, Link, SearchResult } from "./types";

const PLUGIN_NAME = "qqpd";
const MAX_CONCURRENT_USERS = 10;
const MAX_CONCURRENT_CHANNELS = 50;

// Storage directory for user config files
const STORAGE_DIR = path.join(
  process.env.CACHE_PATH || "./cache",
  "qqpd_users",
);

interface LinkPattern {
  pattern: RegExp;
  type: string;
}

// Pan link regex patterns for extraction from message content
const LINK_PATTERNS: LinkPattern[] = [
  { pattern: /https:\/\/pan\.quark\.cn\/s\/[^\s\n]+/g, type: "quark" },
  { pattern: /https:\/\/drive\.uc\.cn\/s\/[^\s\n]+/g, type: "uc" },
  { pattern: /https:\/\/pan\.uc\.cn\/s\/[^\s\n]+/g, type: "uc" },
  {
    pattern: /https:\/\/pan\.baidu\.com\/s\/[^\s\n?]+(?:\?pwd=[a-zA-Z0-9]+)?/g,
    type: "baidu",
  },
  {
    pattern: /https:\/\/(?:aliyundrive\.com|www\.alipan\.com)\/s\/[^\s\n]+/g,
    type: "aliyun",
  },
  { pattern: /https:\/\/pan\.xunlei\.com\/s\/[^\s\n]+/g, type: "xunlei" },
  {
    pattern: /https:\/\/cloud\.189\.cn\/(?:t|web\/share)\/[^\s\n]+/g,
    type: "tianyi",
  },
  {
    pattern:
      /https:\/\/(?:115\.com|115cdn\.com)\/s\/[^\s\n?]+(?:\?password=[a-zA-Z0-9]+)?/g,
    type: "115",
  },
  {
    pattern:
      /https:\/\/(?:123pan\.cn|www\.123912\.com|www\.123684\.com|www\.123685\.com|www\.123592\.com|www\.123pan\.com)\/s\/[^\s\n]+/g,
    type: "123",
  },
  {
    pattern: /https:\/\/caiyun\.(?:139\.com|feixin\.10086\.cn)\/[^\s\n]+/g,
    type: "mobile",
  },
  { pattern: /https:\/\/mypikpak\.com\/s\/[^\s\n]+/g, type: "pikpak" },
  { pattern: /https:\/\/pan\.pikpak\.com\/s\/[^\s\n]+/g, type: "pikpak" },
  { pattern: /magnet:\?xt=urn:btih:[^\n]+/g, type: "magnet" },
  { pattern: /ed2k:\/\/\|file\|[^\n]+?\|\//g, type: "ed2k" },
];

// Password extraction patterns
const PWD_PATTERNS = [
  /pwd=([a-zA-Z0-9]+)/,
  /password=([a-zA-Z0-9]+)/,
  /(?:提取码|密码|访问码)[：:\s]*([a-zA-Z0-9]{4,8})/,
  /(?:pwd|code)[=:：]\s*([a-zA-Z0-9]{4,8})/,
];

interface User {
  hash: string;
  status?: string;
  expire_at?: string;
  cookie?: string;
  channels?: string[];
  channel_guild_ids?: Record<string, string>;
  last_access_at?: string;
  [key: string]: unknown;
}

interface ChannelTask {
  channelID: string;
  guildID: string;
  userHash: string;
  cookie: string;
  user: User;
}

interface SearchResultWithImages extends SearchResult {
  images?: string[];
}

/**
 * Parse a cookie string into a key-value map, skipping cookie attributes.
 */
function parseCookieString(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieStr) {
    return cookies;
  }

  const skipAttrs = new Set([
    "domain",
    "path",
    "expires",
    "max-age",
    "samesite",
    "secure",
    "httponly",
  ]);

  const pairs = cookieStr.split(";");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.substring(0, idx).trim();
      const value = trimmed.substring(idx + 1).trim();
      if (key && value && !skipAttrs.has(key.toLowerCase())) {
        cookies[key] = value;
      }
    }
  }

  return cookies;
}

/**
 * Compute bkn value from p_skey (same algorithm as Go version).
 */
function bkn(skey: string): number {
  let t = 5381;
  for (let n = 0; n < skey.length; n++) {
    // Use bitwise operations consistent with the Go implementation.
    // In JS we need to handle 32-bit integer overflow carefully.
    t += (t << 5) + skey.charCodeAt(n);
  }
  return t & 2147483647;
}

/**
 * Build cookie header string from a cookie map.
 */
function buildCookieHeader(cookieMap: Record<string, string>): string {
  return Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

class QqpdPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  /**
   * Load all user config files from the storage directory.
   * Returns an array of user objects.
   */
  private loadAllUsers(): User[] {
    const users: User[] = [];

    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        return users;
      }

      const files = fs.readdirSync(STORAGE_DIR);
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }

        try {
          const filePath = path.join(STORAGE_DIR, file);
          const data = fs.readFileSync(filePath, "utf-8");
          const user = JSON.parse(data);
          if (user && user.hash) {
            users.push(user);
          }
        } catch {
          // Skip invalid user files
        }
      }
    } catch {
      // Storage dir doesn't exist or not readable
    }

    return users;
  }

  /**
   * Save a user config back to disk (e.g. after updating channel_guild_ids cache).
   */
  private saveUser(user: User): void {
    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
      }
      const filePath = path.join(STORAGE_DIR, user.hash + ".json");
      fs.writeFileSync(filePath, JSON.stringify(user, null, 2), "utf-8");
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Filter to only active users (status=active, cookie not expired, has channels).
   */
  private getActiveUsers(allUsers: User[]): User[] {
    const now = new Date();
    const active: User[] = [];

    for (const user of allUsers) {
      // Must be active status
      if (user.status !== "active") {
        continue;
      }

      // Check cookie expiration
      if (user.expire_at) {
        const expireAt = new Date(user.expire_at);
        if (!isNaN(expireAt.getTime()) && now > expireAt) {
          // Cookie expired - mark as expired and save
          user.status = "expired";
          user.cookie = "";
          this.saveUser(user);
          continue;
        }
      }

      // Must have channels
      if (!user.channels || user.channels.length === 0) {
        continue;
      }

      // Must have a cookie
      if (!user.cookie) {
        continue;
      }

      active.push(user);
    }

    return active;
  }

  /**
   * Build channel tasks: collect unique channels from all users, assign each
   * to a user with load balancing.
   */
  private buildChannelTasks(users: User[]): ChannelTask[] {
    // 1. Collect all channels and their owning users
    const channelOwners = new Map<string, User[]>(); // channelID -> [user, ...]

    for (const user of users) {
      for (const channelID of user.channels || []) {
        if (!channelOwners.has(channelID)) {
          channelOwners.set(channelID, []);
        }
        channelOwners.get(channelID)!.push(user);
      }
    }

    // 2. For each unique channel, assign to the user with the fewest tasks (load balancing)
    const tasks: ChannelTask[] = [];
    const userTaskCount = new Map<string, number>(); // userHash -> count

    for (const [channelID, owners] of channelOwners) {
      // Pick the user with the fewest tasks assigned so far
      let selectedUser = owners[0];
      let minTasks = userTaskCount.get(selectedUser.hash) || 0;

      for (const owner of owners) {
        const count = userTaskCount.get(owner.hash) || 0;
        if (count < minTasks) {
          selectedUser = owner;
          minTasks = count;
        }
      }

      // Get guild_id from user's cache
      let guildID = "";
      if (
        selectedUser.channel_guild_ids &&
        selectedUser.channel_guild_ids[channelID]
      ) {
        guildID = selectedUser.channel_guild_ids[channelID];
      }

      tasks.push({
        channelID,
        guildID,
        userHash: selectedUser.hash,
        cookie: selectedUser.cookie || "",
        user: selectedUser, // Keep reference for saving cache updates
      });

      userTaskCount.set(
        selectedUser.hash,
        (userTaskCount.get(selectedUser.hash) || 0) + 1,
      );
    }

    return tasks;
  }

  /**
   * Resolve a channel number to a guild_id by visiting pd.qq.com/g/{channelNumber}
   * and extracting the guild_id from the page HTML.
   */
  private async resolveGuildID(
    channelNumber: string,
    cookieStr: string,
  ): Promise<string> {
    // If already a pure numeric guild_id, return as-is
    if (/^\d+$/.test(channelNumber)) {
      return channelNumber;
    }

    try {
      const url = `https://pd.qq.com/g/${channelNumber}`;
      const resp = await fetchWithRetry(
        url,
        {
          headers: {
            "User-Agent": getRandomUA(),
            Cookie: cookieStr || "",
          },
          redirect: "follow",
        } as RequestInit,
        { timeout: 10000, retries: 1 },
      );

      const html = await resp.text();

      // Extract guild_id from HTML: look for https://groupprohead.gtimg.cn/{guild_id}/
      const match = html.match(/https:\/\/groupprohead\.gtimg\.cn\/(\d+)\//);
      if (match && match[1]) {
        return match[1];
      }
    } catch {
      // Fall through to return original channel number
    }

    return channelNumber;
  }

  /**
   * Refresh cookies by visiting pd.qq.com to get updated uuid and other dynamic fields.
   * Returns the merged cookie string.
   */
  private async refreshCookie(cookieStr: string): Promise<string> {
    if (!cookieStr) {
      return cookieStr;
    }

    const oldCookies = parseCookieString(cookieStr);
    let uin = oldCookies["uin"] || "";
    if (!uin) {
      return cookieStr;
    }

    // Strip o0/o prefix from uin
    if (uin.startsWith("o0")) {
      uin = uin.substring(2);
    } else if (uin.startsWith("o")) {
      uin = uin.substring(1);
    }

    try {
      const resp = await fetchWithRetry(
        "https://pd.qq.com/explore",
        {
          headers: {
            Cookie: cookieStr,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          redirect: "manual",
        } as RequestInit,
        { timeout: 10000, retries: 0 },
      );

      // Extract Set-Cookie headers from response
      const setCookieHeaders = resp.headers.getSetCookie
        ? resp.headers.getSetCookie()
        : [];
      const newCookies: Record<string, string> = {};

      for (const header of setCookieHeaders) {
        const idx = header.indexOf("=");
        if (idx > 0) {
          const key = header.substring(0, idx).trim();
          let rest = header.substring(idx + 1);
          // Take value up to the first semicolon
          const semiIdx = rest.indexOf(";");
          if (semiIdx >= 0) {
            rest = rest.substring(0, semiIdx);
          }
          const value = rest.trim();
          if (key && value) {
            newCookies[key] = value;
          }
        }
      }

      if (Object.keys(newCookies).length > 0) {
        // Merge: old cookies first, then overwrite with new
        const merged = { ...oldCookies, ...newCookies };

        // Ensure uin has correct format
        if (!merged["uin"] || !merged["uin"].startsWith("o")) {
          merged["uin"] = "o0" + uin;
        }

        return buildCookieHeader(merged);
      }
    } catch {
      // Return original on error
    }

    return cookieStr;
  }

  /**
   * Search a single channel using the QQ Channel search API.
   */
  private async searchSingleChannel(
    keyword: string,
    cookieStr: string,
    channelID: string,
    guildID: string,
  ): Promise<SearchResult[]> {
    if (!guildID) {
      return [];
    }

    // Refresh cookies to update dynamic fields (uuid etc.)
    try {
      cookieStr = await this.refreshCookie(cookieStr);
    } catch {
      // Use original cookie if refresh fails
    }

    // Parse cookie to get p_skey
    const cookies = parseCookieString(cookieStr);
    const pSkey = cookies["p_skey"];
    if (!pSkey) {
      return [];
    }

    // Compute bkn
    const bknValue = bkn(pSkey);
    const apiURL = `https://pd.qq.com/qunng/guild/gotrpc/auth/trpc.group_pro.in_guild_search_svr.InGuildSearch/NewSearch?bkn=${bknValue}`;

    // Build request payload
    const payload = {
      guild_id: guildID,
      query: keyword,
      cookie: "",
      member_cookie: "",
      search_type: {
        type: 0,
        feed_type: 0,
      },
      cond: {
        channel_ids: [],
        feed_rank_type: 0,
        type_list: [2, 3],
      },
    };

    try {
      const resp = await fetchWithRetry(
        apiURL,
        {
          method: "POST",
          headers: {
            "x-oidb": '{"uint32_command":"0x9287","uint32_service_type":"2"}',
            "Content-Type": "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: "https://pd.qq.com/",
            Origin: "https://pd.qq.com",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Cookie: cookieStr,
          },
          body: JSON.stringify(payload),
        } as RequestInit,
        { timeout: 15000, retries: 1 },
      );

      const apiResp = (await resp.json()) as any;

      // Navigate response: data.union_result.guild_feeds
      const data = apiResp.data;
      if (!data) {
        return [];
      }

      const unionResult = data.union_result;
      if (!unionResult) {
        return [];
      }

      const guildFeeds = unionResult.guild_feeds;
      if (!Array.isArray(guildFeeds) || guildFeeds.length === 0) {
        return [];
      }

      // Parse each feed item
      const results: SearchResult[] = [];
      for (let i = 0; i < guildFeeds.length; i++) {
        const item = guildFeeds[i];
        if (!item) {
          continue;
        }

        const result = this.extractResultInfo(item, channelID, i);
        if (result && result.title && result.links.length > 0) {
          results.push(result);
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Extract a search result from a guild_feed item.
   */
  private extractResultInfo(
    item: any,
    channelID: string,
    index: number,
  ): SearchResult | null {
    // Extract title (strip "名称：" prefix, take first line only)
    let title = item.title || "";
    if (title.startsWith("名称：")) {
      title = title.substring("名称：".length);
    }
    const nlIdx = title.indexOf("\n");
    if (nlIdx > 0) {
      title = title.substring(0, nlIdx);
    }
    title = title.trim();

    // Extract content and links
    const content = item.content || "";
    const links = this.extractLinksFromContent(content);

    // Extract datetime from create_time (Unix timestamp string)
    let datetime = new Date().toISOString();
    if (item.create_time) {
      const timestamp = parseInt(item.create_time, 10);
      if (!isNaN(timestamp)) {
        datetime = new Date(timestamp * 1000).toISOString();
      }
    }

    // Extract image URLs
    const images: string[] = [];
    if (Array.isArray(item.images)) {
      for (const img of item.images) {
        if (img && img.url) {
          images.push(img.url);
        }
      }
    }

    return {
      uniqueId: `qqpd-${channelID}-${index}`,
      title,
      content,
      links,
      channel: "",
      datetime,
      tags: [],
    };
  }

  /**
   * Extract pan links from message content (auto-deduplicate).
   */
  private extractLinksFromContent(content: string): Link[] {
    if (!content) {
      return [];
    }

    const links: Link[] = [];
    const seen = new Set<string>();

    for (const lp of LINK_PATTERNS) {
      // Reset regex lastIndex for global patterns
      lp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null = lp.pattern.exec(content);
      while (match !== null) {
        const url = match[0];
        if (seen.has(url)) {
          match = lp.pattern.exec(content);
          continue;
        }
        seen.add(url);

        // Try to extract password from the URL itself
        let password = "";
        for (const pwdPattern of PWD_PATTERNS) {
          const pwdMatch = url.match(pwdPattern);
          if (pwdMatch) {
            password = pwdMatch[1];
            break;
          }
        }

        // If no password in URL, try surrounding context
        if (!password) {
          const start = content.indexOf(url);
          if (start !== -1) {
            const ctxStart = Math.max(0, start - 50);
            const ctxEnd = Math.min(content.length, start + url.length + 80);
            const context = content.substring(ctxStart, ctxEnd);
            for (const pwdPattern of PWD_PATTERNS) {
              const pwdMatch = context.match(pwdPattern);
              if (pwdMatch) {
                password = pwdMatch[1];
                break;
              }
            }
          }
        }

        links.push({
          type: lp.type as CloudType,
          url,
          password,
        });

        match = lp.pattern.exec(content);
      }
    }

    return links;
  }

  /**
   * Main search method.
   *
   * Flow:
   * 1. Load user configs from storage directory
   * 2. Filter to active users
   * 3. Build channel tasks (unique channels, load balanced across users)
   * 4. For each task, resolve guild_id if needed, then search the channel
   * 5. Return all results (no keyword filtering - left to caller/service layer)
   */
  async search(
    keyword: string,
    ext: Record<string, unknown> = {},
  ): Promise<SearchResult[]> {
    if (!keyword) {
      return [];
    }

    // 1. Load all users from disk
    const allUsers = this.loadAllUsers();
    if (allUsers.length === 0) {
      return [];
    }

    // 2. Get active users
    let activeUsers = this.getActiveUsers(allUsers);
    if (activeUsers.length === 0) {
      return [];
    }

    // 3. Limit user count (take most recently active)
    if (activeUsers.length > MAX_CONCURRENT_USERS) {
      activeUsers.sort((a, b) => {
        const aTime = a.last_access_at
          ? new Date(a.last_access_at).getTime()
          : 0;
        const bTime = b.last_access_at
          ? new Date(b.last_access_at).getTime()
          : 0;
        return bTime - aTime; // Descending: most recent first
      });
      activeUsers = activeUsers.slice(0, MAX_CONCURRENT_USERS);
    }

    // 4. Build channel tasks (unique channels, load balanced)
    const tasks = this.buildChannelTasks(activeUsers);
    if (tasks.length === 0) {
      return [];
    }

    // 5. Resolve guild_ids for tasks that don't have one cached
    for (const task of tasks) {
      if (!task.guildID) {
        try {
          task.guildID = await this.resolveGuildID(task.channelID, task.cookie);

          // Cache the resolved guild_id back to the user's config
          if (task.guildID && task.user) {
            if (!task.user.channel_guild_ids) {
              task.user.channel_guild_ids = {};
            }
            task.user.channel_guild_ids[task.channelID] = task.guildID;
            this.saveUser(task.user);
          }
        } catch {
          task.guildID = task.channelID; // Fallback
        }
      }
    }

    // 6. Execute channel search tasks concurrently (max MAX_CONCURRENT_CHANNELS)
    const allResults: SearchResult[] = [];

    // Process in batches of MAX_CONCURRENT_CHANNELS
    for (let i = 0; i < tasks.length; i += MAX_CONCURRENT_CHANNELS) {
      const batch = tasks.slice(i, i + MAX_CONCURRENT_CHANNELS);

      const batchResults = await Promise.allSettled(
        batch.map((task) =>
          this.searchSingleChannel(
            keyword,
            task.cookie,
            task.channelID,
            task.guildID,
          ),
        ),
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled" && Array.isArray(result.value)) {
          allResults.push(...result.value);
        }
      }
    }

    return allResults;
  }
}

export default QqpdPlugin;
