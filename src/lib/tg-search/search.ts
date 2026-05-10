import { getRuntimeEnvValue, type RuntimeEnv } from "@/lib/runtime-env";
import type {
  BasePluginInterface,
  SearchResult as PluginResult,
} from "@/searchplugins/types";

import { parseSearchResults } from "./parser";
import type {
  LinkType,
  MergedLink,
  MergedLinks,
  SearchResponse,
  SearchResult,
} from "./types";

const FALLBACK_CHANNELS = [
  "Quark_Movies",
  "ucquark",
  "QuarkFree",
  "yunpanquark",
  "kuakedongman",
  "shareAliyun",
  "Aliyun_4K_Movies",
];

function getDefaultChannels(env?: RuntimeEnv): string[] {
  const channels = getRuntimeEnvValue(env, "TG_CHANNELS");
  if (!channels) {
    return FALLBACK_CHANNELS;
  }
  return channels
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** 构建搜索URL */
function buildSearchUrl(channel: string, keyword: string): string {
  const baseURL = `https://t.me/s/${channel}`;
  if (keyword) {
    return `${baseURL}?q=${encodeURIComponent(keyword)}`;
  }
  return baseURL;
}

/** 获取频道HTML内容 */
async function fetchChannelHtml(
  channel: string,
  keyword: string,
): Promise<string> {
  const url = buildSearchUrl(channel, keyword);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();

  if (!html.includes("tgme_widget_message_wrap")) {
    console.warn(
      `[tg-search] Channel "${channel}" returned no messages for keyword "${keyword}"`,
    );
  }

  return html;
}

/** 按网盘类型合并结果 */
export function mergeResultsByType(results: SearchResult[]): MergedLinks {
  const merged: MergedLinks = {};

  for (const result of results) {
    for (const link of result.links) {
      const type = link.type;

      if (!merged[type]) {
        merged[type] = [];
      }

      // 检查是否已存在相同URL（去重）
      const exists = merged[type].some((item) => item.url === link.url);
      if (!exists) {
        const mergedLink: MergedLink = {
          url: link.url,
          password: link.password,
          note: link.work_title || result.title,
          datetime: result.datetime,
          source: `tg:${result.channel}`,
          images: result.images,
        };
        merged[type].push(mergedLink);
      }
    }
  }

  // 按时间倒序排序每个类型的链接
  for (const type in merged) {
    merged[type].sort((a, b) => {
      return new Date(b.datetime).getTime() - new Date(a.datetime).getTime();
    });
  }

  return merged;
}

/** plugin Link 类型映射到 tg-search LinkType */
function mapPluginLinkType(type: string): LinkType {
  const map: Record<string, LinkType> = {
    quark: "quark",
    uc: "uc",
    baidu: "baidu",
    aliyun: "aliyun",
    xunlei: "xunlei",
    tianyi: "tianyi",
    115: "115",
    123: "123",
    pikpak: "pikpak",
    mobile: "mobile",
  };
  return map[type] ?? "others";
}

/** 将 plugin 结果映射为 MergedLink */
function mapPluginResultToMergedLink(
  result: PluginResult,
  pluginName: string,
): MergedLink {
  const primary = result.links[0];
  return {
    url: primary.url,
    password: primary.password,
    note: result.title,
    datetime: result.datetime,
    source: `plugin:${pluginName}`,
    images: undefined,
  };
}

/** 合并 TG 和 plugin 的 merged_by_type 结果（按 URL 去重） */
function mergeMergedLinks(
  tgLinks: MergedLinks,
  pluginLinks: MergedLink[],
): MergedLinks {
  const merged: MergedLinks = { ...tgLinks };

  for (const link of pluginLinks) {
    const type = mapPluginLinkType(link.url);
    if (!merged[type]) {
      merged[type] = [];
    }
    // 按 URL 去重
    const exists = merged[type].some((item) => item.url === link.url);
    if (!exists) {
      merged[type].push(link);
    }
  }

  // 按时间倒序排序
  for (const type in merged) {
    merged[type].sort(
      (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime(),
    );
  }

  return merged;
}

/** 统一搜索入口（TG + 可选 plugin） */
export async function search(
  keyword: string,
  channels?: string[],
  resultType: "results" | "merged_by_type" | "all" = "merged_by_type",
  includePlugins?: boolean,
  pluginNames?: string[],
  env?: RuntimeEnv,
): Promise<SearchResponse> {
  // 先执行 TG 搜索
  const tgResponse = await searchTG(keyword, channels, resultType, env);

  if (!includePlugins) {
    return tgResponse;
  }

  // 动态加载 plugin 模块，避免在 Workers 等不支持 Node.js API 的环境中构建失败
  let pluginLinks: MergedLink[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - dynamic import to avoid bundling cheerio/node:stream in Workers
    const mod = await import(
      /* @vite-ignore */
      "@/searchplugins"
    );
    const pluginMap = mod.pluginMap;
    const allPlugins = mod.allPlugins;
    const searchPlugins = mod.searchAll;

    // 选择插件
    let plugins: BasePluginInterface[];
    if (pluginNames && pluginNames.length > 0) {
      plugins = pluginNames
        .map((name) => pluginMap[name])
        .filter((p): p is BasePluginInterface => p !== undefined);
    } else {
      plugins = allPlugins;
    }

    const pluginResults = await searchPlugins(keyword, plugins);
    pluginLinks = pluginResults.map((r) => {
      const pluginName =
        plugins.find((p) => p.name === r.channel) ?? plugins[0];
      return mapPluginResultToMergedLink(r, pluginName?.name ?? "unknown");
    });
  } catch (err) {
    console.error("[tg-search] plugin search failed:", err);
    // plugin 失败时仍返回 TG 结果
  }

  if (resultType === "results") {
    // results 模式不混入 plugin 结果
    return tgResponse;
  }

  // merged_by_type / all 模式：合并 TG 和 plugin 结果
  const merged = mergeMergedLinks(tgResponse.merged_by_type ?? {}, pluginLinks);
  const total = Object.values(merged).reduce(
    (sum, links) => sum + links.length,
    0,
  );

  return {
    total,
    ...(resultType === "all" ? { results: tgResponse.results } : {}),
    merged_by_type: merged,
  };
}

/** 搜索TG频道 */
export async function searchTG(
  keyword: string,
  channels?: string[],
  resultType: "results" | "merged_by_type" | "all" = "merged_by_type",
  env?: RuntimeEnv,
): Promise<SearchResponse> {
  const resolved = channels?.length ? channels : getDefaultChannels(env);

  // 并行抓取所有频道
  const fetchPromises = resolved.map(async (channel) => {
    try {
      const html = await fetchChannelHtml(channel, keyword);
      return parseSearchResults(html, channel);
    } catch (error) {
      console.error(`Error fetching channel ${channel}:`, error);
      return [];
    }
  });

  const channelResults = await Promise.all(fetchPromises);

  // 合并所有频道的结果
  const allResults = channelResults.flat();

  // 按unique_id去重
  const uniqueResults = new Map<string, SearchResult>();
  for (const result of allResults) {
    if (!uniqueResults.has(result.unique_id)) {
      uniqueResults.set(result.unique_id, result);
    }
  }

  const results = Array.from(uniqueResults.values());

  // 按时间倒序排序
  results.sort((a, b) => {
    return new Date(b.datetime).getTime() - new Date(a.datetime).getTime();
  });

  // 根据resultType返回不同格式
  const response: SearchResponse = {
    total: results.length,
  };

  if (resultType === "results") {
    response.results = results;
  } else if (resultType === "merged_by_type") {
    response.merged_by_type = mergeResultsByType(results);
  } else if (resultType === "all") {
    response.results = results;
    response.merged_by_type = mergeResultsByType(results);
  }

  return response;
}
