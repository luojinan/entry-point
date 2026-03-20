/**
 * sousou 插件 - Sousou搜索 (sousou.pro)
 * 翻译自 Go 插件: plugin/sousou/sousou.go
 */

const { BasePlugin, filterByKeyword, deduplicateResults, fetchWithRetry } = require('./base');

const SOUSOU_API = 'https://sousou.pro/api.php';
const DEFAULT_PER_SIZE = 30;
const DEFAULT_MAX_PAGES = 3;

// 支持的网盘类型列表
const SUPPORTED_DISK_TYPES = ['QUARK', 'BDY', 'ALY', 'XUNLEI', 'UC', '115'];

class SousouPlugin extends BasePlugin {
  constructor() {
    super('sousou', 3);
  }

  /**
   * 将API的网盘类型转换为标准链接类型
   */
  _convertDiskType(diskType) {
    const map = {
      'BDY': 'baidu',
      'ALY': 'aliyun',
      'QUARK': 'quark',
      'TIANYI': 'tianyi',
      'UC': 'uc',
      'CAIYUN': 'mobile',
      '115': '115',
      'XUNLEI': 'xunlei',
      '123PAN': '123',
      'PIKPAK': 'pikpak',
    };
    return map[diskType] || 'others';
  }

  /**
   * 处理标签字段
   */
  _processTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) {
      return tags.filter(t => typeof t === 'string' && t !== '');
    }
    return [];
  }

  /**
   * 搜索指定网盘类型的所有页
   */
  async _searchByType(keyword, diskType) {
    const promises = [];

    for (let page = 1; page <= DEFAULT_MAX_PAGES; page++) {
      const apiURL = `${SOUSOU_API}?action=search&q=${encodeURIComponent(keyword)}&page=${page}&per_size=${DEFAULT_PER_SIZE}&type=${diskType}`;

      const promise = fetchWithRetry(apiURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Connection': 'keep-alive',
          'Referer': 'https://sousou.pro/',
        },
      }, { timeout: 30000, retries: 1 })
        .then(resp => resp.json())
        .then(apiResp => {
          if (apiResp.code !== 200) return [];
          return apiResp.data?.list || [];
        })
        .catch(() => []);

      promises.push(promise);
    }

    const pageResults = await Promise.all(promises);
    let allItems = [];
    for (const items of pageResults) {
      allItems = allItems.concat(items);
    }
    return allItems;
  }

  /**
   * 去重处理
   */
  _deduplicateItems(items) {
    const uniqueMap = new Map();

    for (const item of items) {
      let key;
      if (item.disk_id) {
        key = item.disk_id;
      } else if (item.link) {
        key = item.link;
      } else {
        key = `${item.disk_name}|${item.disk_type}`;
      }

      if (uniqueMap.has(key)) {
        const existing = uniqueMap.get(key);
        let existingScore = (existing.files || '').length;
        let newScore = (item.files || '').length;
        if (!existing.disk_pass && item.disk_pass) newScore += 5;
        if (!existing.shared_time && item.shared_time) newScore += 3;
        if (!existing.tags && item.tags) newScore += 2;
        if (newScore > existingScore) {
          uniqueMap.set(key, item);
        }
      } else {
        uniqueMap.set(key, item);
      }
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * 将API响应转换为标准SearchResult格式
   */
  _convertResults(items) {
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.link) continue;

      const link = {
        url: item.link,
        type: this._convertDiskType(item.disk_type),
        password: item.disk_pass || '',
      };

      let uniqueId = `sousou-${item.disk_id}`;
      if (!item.disk_id) {
        uniqueId = `sousou-${Date.now()}-${i}`;
      }

      const tags = this._processTags(item.tags);

      results.push({
        uniqueId,
        title: item.disk_name || '',
        content: item.files || '',
        datetime: item.shared_time || '',
        tags,
        links: [link],
        channel: '',
      });
    }
    return results;
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    // 并发搜索每种网盘类型
    const typePromises = SUPPORTED_DISK_TYPES.map(diskType =>
      this._searchByType(keyword, diskType).catch(() => [])
    );

    const typeResults = await Promise.all(typePromises);

    let allItems = [];
    for (const items of typeResults) {
      allItems = allItems.concat(items);
    }

    if (allItems.length === 0) {
      throw new Error('所有搜索任务都失败或无结果');
    }

    // 去重处理
    const uniqueItems = this._deduplicateItems(allItems);

    // 转换为标准格式
    const results = this._convertResults(uniqueItems);

    // 关键词过滤
    return filterByKeyword(results, keyword);
  }
}

module.exports = SousouPlugin;
