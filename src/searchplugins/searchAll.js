/**
 * 并行聚合搜索引擎
 * 对应 Go 版的 service/search_service.go searchPlugins()
 */

const { deduplicateResults } = require('./base');

/**
 * 并行执行所有插件搜索
 * @param {string} keyword - 搜索关键词
 * @param {BasePlugin[]} plugins - 插件实例列表
 * @param {object} options
 * @param {number} options.timeout - 超时毫秒数，默认 30000
 * @param {number} options.concurrency - 最大并发数，默认不限制
 * @param {object} options.ext - 扩展参数传给每个插件
 * @returns {Promise<Array>} 合并后的搜索结果
 */
async function searchAll(keyword, plugins, options = {}) {
  const { timeout = 30000, ext = {} } = options;

  const tasks = plugins.map(plugin => {
    return Promise.race([
      plugin.search(keyword, ext).catch(err => {
        console.error(`[${plugin.name}] 搜索失败:`, err.message);
        return [];
      }),
      new Promise(resolve => setTimeout(() => {
        console.warn(`[${plugin.name}] 搜索超时`);
        resolve([]);
      }, timeout)),
    ]);
  });

  const allResults = await Promise.allSettled(tasks);

  const merged = allResults
    .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
    .flatMap(r => r.value)
    .filter(r => r.links && r.links.length > 0);

  return deduplicateResults(merged);
}

module.exports = { searchAll };
