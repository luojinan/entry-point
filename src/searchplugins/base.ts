/**
 * 插件基类和通用工具
 */

import crypto from "crypto";

import type { BasePluginInterface, CloudType, SearchResult } from "./types";

// 通用 UA 列表
export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
];

export function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 生成唯一 ID
 */
export function generateUniqueID(
  pluginName: string,
  ...parts: string[]
): string {
  const key = parts.join("|");
  const hash = crypto.createHash("md5").update(key).digest("hex").slice(0, 16);
  return `${pluginName}-${hash}`;
}

/**
 * 清理 HTML 标签
 */
export function cleanHTML(html: string | null | undefined): string {
  if (!html) {
    return "";
  }
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * 判断网盘链接类型
 */
export function determineCloudType(url: string | null | undefined): CloudType {
  if (!url) {
    return "others";
  }
  if (url.includes("pan.quark.cn")) {
    return "quark";
  }
  if (url.includes("drive.uc.cn")) {
    return "uc";
  }
  if (url.includes("pan.baidu.com")) {
    return "baidu";
  }
  if (url.includes("aliyundrive.com") || url.includes("alipan.com")) {
    return "aliyun";
  }
  if (url.includes("pan.xunlei.com")) {
    return "xunlei";
  }
  if (url.includes("cloud.189.cn")) {
    return "tianyi";
  }
  if (url.includes("115.com")) {
    return "115";
  }
  if (url.includes("123pan.com")) {
    return "123";
  }
  if (url.includes("mypikpak.com")) {
    return "pikpak";
  }
  if (url.includes("pan.qoark.cn")) {
    return "quark";
  }
  return "others";
}

/**
 * 混合盘 diskType 映射
 */
export function convertDiskType(diskType: string): CloudType {
  const map: Record<string, CloudType> = {
    BDY: "baidu",
    ALY: "aliyun",
    QUARK: "quark",
    TIANYI: "tianyi",
    UC: "uc",
    CAIYUN: "mobile",
    "115": "115",
    XUNLEI: "xunlei",
    "123PAN": "123",
    PIKPAK: "pikpak",
  };
  return map[diskType] || "others";
}

/**
 * 提取提取码
 */
export function extractPassword(text: string | null | undefined): string {
  if (!text) {
    return "";
  }
  const patterns = [
    /提取码[：:]\s*([0-9a-zA-Z]+)/,
    /密码[：:]\s*([0-9a-zA-Z]+)/,
    /pwd[=:：]\s*([0-9a-zA-Z]+)/,
    /code[=:：]\s*([0-9a-zA-Z]+)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      return m[1];
    }
  }
  return "";
}

/**
 * 带超时的 fetch
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // If caller already set a signal, we need to combine them
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的 fetch
 * @param url - 请求地址
 * @param options - fetch 选项
 * @param timeout - 超时毫秒数，默认 30000 (Cloudflare Workers 延迟较高)
 * @param retries - 重试次数，默认 2
 * @param acceptNonOk - 是否接受非2xx响应（不重试），默认 false
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  {
    timeout = 30000,
    retries = 2,
    acceptNonOk = false,
  }: { timeout?: number; retries?: number; acceptNonOk?: boolean } = {},
): Promise<Response> {
  let lastErr: Error | undefined;
  let lastResp: Response | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchWithTimeout(url, options, timeout);
      // Return immediately for OK responses
      if (resp.ok) {
        return resp;
      }
      // If caller accepts non-OK, return the response as-is (let caller handle status codes)
      if (acceptNonOk) {
        return resp;
      }
      // For server errors (5xx), retry; for client errors (4xx), return immediately
      if (resp.status >= 400 && resp.status < 500) {
        return resp;
      }
      lastErr = new Error(`HTTP ${resp.status}`);
      lastResp = resp;
    } catch (err) {
      lastErr = err as Error;
    }
    if (i < retries) {
      await new Promise((r) => setTimeout(r, 2 ** i * 300));
    }
  }
  // If we have a response (even non-OK), return it rather than throwing
  if (lastResp) {
    return lastResp;
  }
  throw lastErr;
}

/**
 * 关键词过滤：结果标题必须包含所有关键词分词
 */
export function filterByKeyword(
  results: SearchResult[],
  keyword: string | null | undefined,
): SearchResult[] {
  if (!keyword) {
    return results;
  }
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return results;
  }
  return results.filter((r) => {
    const title = (r.title || "").toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

/**
 * 按 uniqueId 去重
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.uniqueId)) {
      return false;
    }
    seen.add(r.uniqueId);
    return true;
  });
}

/**
 * 插件基类
 */
export abstract class BasePlugin implements BasePluginInterface {
  name: string;
  priority: number;

  constructor(name: string, priority: number = 3) {
    this.name = name;
    this.priority = priority;
  }

  /**
   * 搜索方法，子类必须实现
   */
  abstract search(
    keyword: string,
    ext?: Record<string, unknown>,
  ): Promise<SearchResult[]>;
}
