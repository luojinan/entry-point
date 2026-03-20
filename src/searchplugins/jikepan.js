const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');

const PLUGIN_NAME = 'jikepan';
const JIKEPAN_API_URL = 'https://api.jikepan.xyz/search';

class JikepanPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    // Build request body
    const reqBody = {
      name: keyword,
      is_all: false,
    };

    // Check ext for custom parameters
    if (ext && ext.is_all === true) {
      reqBody.is_all = true;
    }

    const resp = await fetchWithRetry(JIKEPAN_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'referer': 'https://jikepan.xyz/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      body: JSON.stringify(reqBody),
    }, { timeout: 10000, retries: 2 });

    const apiResp = await resp.json();

    // Check response status
    if (apiResp.msg !== 'success') {
      throw new Error(`API returned error: ${apiResp.msg}`);
    }

    // Convert results
    return this.convertResults(apiResp.list || []);
  }

  convertResults(items) {
    const results = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Skip items with no links
      if (!item.links || item.links.length === 0) continue;

      // Create link list
      const links = [];
      for (const link of item.links) {
        let linkType = this.convertLinkType(link.service);

        // Special handling for 'others' type - check URL
        if (linkType === 'others' && link.link && link.link.toLowerCase().includes('drive.uc.cn')) {
          linkType = 'uc';
        }

        // Skip unknown types
        if (linkType === '') continue;

        links.push({
          url: link.link || '',
          type: linkType,
          password: link.pwd || '',
        });
      }

      if (links.length === 0) continue;

      const uniqueId = `jikepan-${i}`;

      results.push({
        uniqueId,
        title: item.name || '',
        content: '',
        datetime: '',
        links,
        tags: [],
        channel: '',
      });
    }

    return results;
  }

  convertLinkType(service) {
    const lower = (service || '').toLowerCase();

    switch (lower) {
      case 'baidu': return 'baidu';
      case 'aliyun': return 'aliyun';
      case 'xunlei': return 'xunlei';
      case 'quark': return 'quark';
      case '189cloud': return 'tianyi';
      case '115': return '115';
      case '123': return '123';
      case 'pikpak': return 'pikpak';
      case 'caiyun': return 'mobile';
      case 'ed2k': return 'ed2k';
      case 'magnet': return 'magnet';
      case 'unknown': return '';
      default: return 'others';
    }
  }
}

module.exports = JikepanPlugin;
