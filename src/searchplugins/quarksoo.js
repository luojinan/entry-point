/**
 * quarksoo 插件 - quarksoo.cc 夸克网盘搜索
 * 翻译自 Go 插件: plugin/quarksoo/quarksoo.go
 */

const { BasePlugin, getRandomUA, generateUniqueID, filterByKeyword, deduplicateResults, fetchWithRetry } = require('./base');

const BASE_URL = 'https://quarksoo.cc/search.php';

class QuarksooPlugin extends BasePlugin {
  constructor() {
    super('quarksoo', 3);
  }

  /**
   * 从HTML中解析搜索结果
   */
  _parseSearchResults(htmlContent, keyword) {
    const results = [];
    const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);

    // 使用正则表达式提取表格行
    // 匹配格式: <tr><td>剧名</td><td><a href="链接">...</a></td></tr>
    const pattern = /<tr>\s*<td>([^<]+)<\/td>\s*<td>\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g;
    let match;

    while ((match = pattern.exec(htmlContent)) !== null) {
      const title = match[1].trim();
      const linkURL = match[2].trim();

      // 跳过表头
      if (title.includes('剧名') || title.includes('网盘链接')) continue;

      // 验证链接是否为夸克网盘
      if (!linkURL.includes('pan.qoark.cn') && !linkURL.includes('pan.quark.cn')) continue;

      // 检查标题是否包含关键词
      const lowerTitle = title.toLowerCase();
      const titleMatched = keywords.every(kw => lowerTitle.includes(kw));
      if (!titleMatched) continue;

      // 识别网盘类型
      const linkType = 'quark';

      // 生成唯一ID
      const uniqueId = generateUniqueID('quarksoo', title, linkURL);

      results.push({
        uniqueId,
        title,
        content: '',
        links: [{
          type: linkType,
          url: linkURL,
          password: '',
        }],
        datetime: new Date().toISOString(),
        tags: [],
        channel: '',
      });
    }

    return results;
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    const searchURL = `${BASE_URL}?q=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': 'https://quarksoo.cc/',
      },
    }, { timeout: 10000, retries: 2 });

    const htmlContent = await resp.text();
    let results = this._parseSearchResults(htmlContent, keyword);

    // 去重
    results = deduplicateResults(results);

    // 按标题排序
    results.sort((a, b) => a.title.localeCompare(b.title));

    // 关键词过滤
    return filterByKeyword(results, keyword);
  }
}

module.exports = QuarksooPlugin;
