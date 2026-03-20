const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');

const PLUGIN_NAME = 'wanou';
const API_URL = 'https://woog.nxog.eu.org/api.php/provide/vod';

// Pre-compiled regex patterns for link type detection
const LINK_PATTERNS = {
  baidu:  /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/,
  quark:  /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/,
  uc:     /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/,
  aliyun: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/,
  xunlei: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/,
  tianyi: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/,
  '115':  /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/,
  mobile: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/,
  '123':  /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/,
  pikpak: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/,
  magnet: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/,
  ed2k:   /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//,
};

const PASSWORD_REGEX = /\?pwd=([0-9a-zA-Z]+)/;

// API type quick mapping
const API_TYPE_MAP = {
  BD: 'baidu',
  KG: 'quark',
  UC: 'uc',
  ALY: 'aliyun',
  XL: 'xunlei',
  TY: 'tianyi',
  '115': '115',
  MB: 'mobile',
  '123': '123',
  PIKPAK: 'pikpak',
};

class WanouPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 1);
  }

  async search(keyword, ext = {}) {
    const searchURL = `${API_URL}?ac=detail&wd=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': 'https://woog.nxog.eu.org/',
        'Cache-Control': 'no-cache',
      },
    }, { timeout: 8000, retries: 2 });

    const data = await resp.json();

    if (data.code !== 1) {
      throw new Error(`API returned error: ${data.msg}`);
    }

    const results = [];
    for (const item of (data.list || [])) {
      const result = this.parseAPIItem(item);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  parseAPIItem(item) {
    const title = (item.vod_name || '').trim();
    if (!title) return null;

    const uniqueId = `${PLUGIN_NAME}-${item.vod_id}`;

    // Build content description
    const contentParts = [];
    if (item.vod_actor) contentParts.push(`主演: ${item.vod_actor}`);
    if (item.vod_director) contentParts.push(`导演: ${item.vod_director}`);
    if (item.vod_area) contentParts.push(`地区: ${item.vod_area}`);
    if (item.vod_year) contentParts.push(`年份: ${item.vod_year}`);
    if (item.vod_remarks) contentParts.push(`状态: ${item.vod_remarks}`);
    const content = contentParts.join(' | ');

    // Parse download links
    const links = this.parseDownloadLinks(item.vod_down_from || '', item.vod_down_url || '');

    // Build tags
    const tags = [];
    if (item.vod_year) tags.push(item.vod_year);
    if (item.vod_area) tags.push(item.vod_area);

    return {
      uniqueId,
      title,
      content,
      links,
      datetime: '',
      tags,
      channel: '',
    };
  }

  parseDownloadLinks(vodDownFrom, vodDownURL) {
    if (!vodDownFrom || !vodDownURL) return [];

    const fromParts = vodDownFrom.split('$$$');
    const urlParts = vodDownURL.split('$$$');
    const minLen = Math.min(fromParts.length, urlParts.length);

    const links = [];
    for (let i = 0; i < minLen; i++) {
      const fromType = fromParts[i].trim();
      const urlStr = urlParts[i].trim();
      if (!urlStr) continue;

      const linkType = this.determineLinkTypeOptimized(fromType, urlStr);
      if (!linkType) continue;

      const password = this.extractPwd(urlStr);
      links.push({ type: linkType, url: urlStr, password });
    }

    return links;
  }

  determineLinkTypeOptimized(apiType, url) {
    // Basic validation
    if (url.includes('javascript:') || url.includes('#') || !url) return '';
    if (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:')) return '';

    // Try API type quick mapping first
    const upperType = apiType.toUpperCase();
    const mappedType = API_TYPE_MAP[upperType];
    if (mappedType) {
      const pattern = LINK_PATTERNS[mappedType];
      if (pattern && pattern.test(url)) {
        return mappedType;
      }
    }

    // Fallback to URL regex matching
    for (const [type, pattern] of Object.entries(LINK_PATTERNS)) {
      if (pattern.test(url)) {
        return type;
      }
    }

    return '';
  }

  extractPwd(url) {
    const match = url.match(PASSWORD_REGEX);
    return match ? match[1] : '';
  }
}

module.exports = WanouPlugin;
