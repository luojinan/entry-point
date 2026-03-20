const { BasePlugin, filterByKeyword, fetchWithRetry } = require('./base');

/**
 * ash 插件 - allsharehub.com 搜索
 * 从搜索页面HTML中提取内嵌JSON数据
 */
class AshPlugin extends BasePlugin {
  constructor() {
    super('ash', 2);
    this.jsonDataRegex = /var jsonData = '(\[.*?\])';/;
    this.controlCharRegex = /[\x00-\x1F\x7F]/g;
    this.wrongQuarkDomain = 'pan.qualk.cn';
    this.correctQuarkDomain = 'pan.quark.cn';
  }

  async search(keyword, ext = {}) {
    const searchURL = `https://so.allsharehub.com/s/${encodeURIComponent(keyword)}.html`;

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://so.allsharehub.com/',
      },
    }, { timeout: 15000, retries: 2 });

    const html = await resp.text();

    // Extract JSON data from HTML
    const matches = this.jsonDataRegex.exec(html);
    if (!matches || !matches[1]) return [];

    let jsonStr = matches[1];

    // Clean JSON string
    if (jsonStr.includes('\\/')) {
      jsonStr = jsonStr.replace(/\\\//g, '/');
    }
    jsonStr = jsonStr.replace(this.controlCharRegex, '');

    let ashResults;
    try {
      ashResults = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`JSON parse failed: ${e.message}`);
    }

    if (!ashResults || ashResults.length === 0) return [];

    const results = [];
    const categoryNames = ['短剧', '电影', '电视剧', '动漫', '综艺', '充电视频'];

    for (const item of ashResults) {
      if (!item.url) continue;

      // Fix pan URL
      const panURL = this._fixPanURL(item.url);
      if (!panURL) continue;

      // Determine pan type by is_type field
      let panType;
      switch (item.is_type) {
        case 0: panType = 'quark'; break;
        case 2: panType = 'baidu'; break;
        case 3: panType = 'uc'; break;
        case 4: panType = 'xunlei'; break;
        default: panType = 'quark'; break;
      }

      // Extract password
      let password = '';
      if (item.code && typeof item.code === 'string' && item.code !== '') {
        password = item.code;
      }

      // Parse datetime
      let datetime = '';
      if (item.times) {
        datetime = item.times;
      }

      // Get tags from category ID
      const tags = [];
      if (item.source_category_id > 0 && item.source_category_id <= 6) {
        tags.push(categoryNames[item.source_category_id - 1]);
      }

      results.push({
        uniqueId: `${this.name}-${item.id}`,
        title: item.title || '',
        content: item.name || '',
        datetime,
        channel: '',
        links: [{
          type: panType,
          url: panURL,
          password,
        }],
        tags,
      });
    }

    return filterByKeyword(results, keyword);
  }

  _fixPanURL(url) {
    if (!url || url.length < 8) return '';
    if (!url.startsWith('http')) return '';

    if (url.includes(this.wrongQuarkDomain)) {
      return url.replace(this.wrongQuarkDomain, this.correctQuarkDomain);
    }

    return url;
  }
}

module.exports = AshPlugin;
