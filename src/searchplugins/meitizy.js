const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');

const BASE_URL = 'https://video.451024.xyz';
const SEARCH_PATH = '/api/search';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_PAGE_SIZE = 1000;

class MeitizyPlugin extends BasePlugin {
  constructor() {
    super('meitizy', 2);
  }

  /**
   * Search for resources
   * @param {string} keyword
   * @param {object} ext
   * @returns {Promise<Array>}
   */
  async search(keyword, ext = {}) {
    const apiURL = BASE_URL + SEARCH_PATH;

    // Build request body
    const reqBody = {
      title: keyword,
      page: 1,
      size: MAX_PAGE_SIZE,
    };

    // Send POST request
    const resp = await fetchWithRetry(apiURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': BASE_URL + '/',
      },
      body: JSON.stringify(reqBody),
    }, { timeout: 30000, retries: 2 });

    const apiResp = await resp.json();

    // Convert to standard format
    const results = this._convertToSearchResults(apiResp.data || []);

    // Filter by keyword
    return filterByKeyword(results, keyword);
  }

  /**
   * Convert API response items to standard search results
   */
  _convertToSearchResults(items) {
    const results = [];

    for (const item of items) {
      // Skip items without links
      if (!item.link) continue;

      // Parse publish time
      let datetime = this._parseTime(item.created_at);
      if (!datetime) datetime = this._parseTime(item.updated_at);
      if (!datetime) datetime = new Date().toISOString();

      // Map link type
      let linkType = this._mapLinkType(item.link_type);
      if (linkType === 'others') {
        linkType = this._determineCloudTypeFromURL(item.link);
      }

      // Build links
      const links = [{
        type: linkType,
        url: item.link,
        password: '',
      }];

      // Build tags
      const tags = [];
      if (item.tags) tags.push(item.tags);

      results.push({
        uniqueId: `${this.name}-${item.id}`,
        title: item.title || '',
        content: item.content || '',
        links,
        datetime,
        tags,
        channel: '',
      });
    }

    return results;
  }

  /**
   * Map API link_type to standard cloud type
   */
  _mapLinkType(apiLinkType) {
    if (!apiLinkType) return 'others';
    switch (apiLinkType.toLowerCase()) {
      case 'alipan': return 'aliyun';
      case 'xunlei': return 'xunlei';
      case 'baidu': return 'baidu';
      case 'quark': return 'quark';
      case 'uc': return 'uc';
      case '115': return '115';
      case '123': return '123';
      case 'tianyi': return 'tianyi';
      case 'mobile': return 'mobile';
      case 'pikpak': return 'pikpak';
      default: return 'others';
    }
  }

  /**
   * Determine cloud type from URL
   */
  _determineCloudTypeFromURL(url) {
    if (!url) return 'others';
    if (url.includes('pan.quark.cn')) return 'quark';
    if (url.includes('drive.uc.cn')) return 'uc';
    if (url.includes('pan.baidu.com')) return 'baidu';
    if (url.includes('aliyundrive.com') || url.includes('alipan.com') || url.includes('www.alipan.com')) return 'aliyun';
    if (url.includes('pan.xunlei.com')) return 'xunlei';
    if (url.includes('cloud.189.cn')) return 'tianyi';
    if (url.includes('caiyun.139.com')) return 'mobile';
    if (url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) return '115';
    if (url.includes('123684.com') || url.includes('123685.com') || url.includes('123912.com') || url.includes('123pan.com') || url.includes('123pan.cn') || url.includes('123592.com')) return '123';
    if (url.includes('mypikpak.com')) return 'pikpak';
    if (url.includes('magnet:')) return 'magnet';
    if (url.includes('ed2k://')) return 'ed2k';
    return 'others';
  }

  /**
   * Parse time string in various formats
   */
  _parseTime(timeStr) {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch (e) {
      // ignore
    }
    return '';
  }
}

module.exports = MeitizyPlugin;
