/**
 * 并行聚合搜索引擎
 * 对应 Go 版的 service/search_service.go searchPlugins()
 */

import { deduplicateResults } from "./base";
import type { BasePluginInterface, SearchResult } from "./types";

/**
 * 并行执行所有插件搜索
 * @param keyword - 搜索关键词
 * @param plugins - 插件实例列表
 * @param options
 * @param options.timeout - 超时毫秒数，默认 30000
 * @param options.ext - 扩展参数传给每个插件
 * @returns 合并后的搜索结果
 */
export async function searchAll(
  keyword: string,
  plugins: BasePluginInterface[],
  options: { timeout?: number; ext?: Record<string, unknown> } = {},
): Promise<SearchResult[]> {
  const { timeout = 30000, ext = {} } = options;

  const tasks = plugins.map((plugin) => {
    return Promise.race([
      plugin.search(keyword, ext).catch((err) => {
        console.error(`[${plugin.name}] 搜索失败:`, err.message);
        return [] as SearchResult[];
      }),
      new Promise<SearchResult[]>((resolve) =>
        setTimeout(() => {
          console.warn(`[${plugin.name}] 搜索超时`);
          resolve([]);
        }, timeout),
      ),
    ]);
  });

  const allResults = await Promise.allSettled(tasks);

  const merged = allResults
    .filter(
      (r): r is PromiseFulfilledResult<SearchResult[]> =>
        r.status === "fulfilled" && Array.isArray(r.value),
    )
    .flatMap((r) => r.value)
    .filter((r) => r.links && r.links.length > 0);

  return deduplicateResults(merged);
}
