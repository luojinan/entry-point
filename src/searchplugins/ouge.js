/**
 * ouge - Ouge (woog) API search plugin
 * Translated from: /plugin/ouge/ouge.go
 *
 * API:
 *   https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd=<keyword>
 *
 * Parse download links by splitting vod_down_from / vod_down_url with "$$$",
 * map API type codes (BD/KG/UC/ALY/XL/TY/115/MB/123/PK) and fallback to URL regex detection.
 */

const {
  BasePlugin,
  fetchWithRetry,
  filterByKeyword,
} = require('./base');

const PLUGIN_NAME = 'ouge';
const API_URL = 'https://woog.nxog.eu.org/api.php/provide/vod';

// Pre-compiled regex patterns for link type detection (kept in sync with Go version)
const LINK_PATTERNS = {
  quark:  /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/,
  uc:     /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/,
  baidu:  /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/,
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

// API type mapping (Go: BD/KG/UC/ALY/XL/TY/115/MB/123/PK)
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
  PK: 'pikpak',
};

class OugePlugin extends BasePlugin {
  constructor() {
    // Go plugin priority is 2
    super(PLUGIN_NAME, 2);
  }

  async search(keyword, ext = {}) {
    const searchURL = `${API_URL}?ac=detail&wd=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
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

    if (!data || data.code !== 1) {
      const msg = data && typeof data.msg === 'string' ? data.msg : 'unknown';
      throw new Error(`API returned error: ${msg}`);
    }

    const results = [];
    for (const item of (data.list || [])) {
      const r = this.parseAPIItem(item);
      if (r) results.push(r);
    }

    return filterByKeyword(results, keyword);
  }

  parseAPIItem(item) {
    const title = (item.vod_name || '').trim();
    if (!title) return null;

    const uniqueId = `${PLUGIN_NAME}-${item.vod_id}`;

    // Build content (Go: 主演/导演/地区/年份/状态)
    const contentParts = [];
    if (item.vod_actor) contentParts.push(`主演: ${item.vod_actor}`);
    if (item.vod_director) contentParts.push(`导演: ${item.vod_director}`);
    if (item.vod_area) contentParts.push(`地区: ${item.vod_area}`);
    if (item.vod_year) contentParts.push(`年份: ${item.vod_year}`);
    if (item.vod_remarks) contentParts.push(`状态: ${item.vod_remarks}`);
    const content = contentParts.join(' | ');

    const links = this.parseDownloadLinks(item.vod_down_from || '', item.vod_down_url || '');
    if (links.length === 0) return null;

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
      const fromType = (fromParts[i] || '').trim();
      const urlStr = (urlParts[i] || '').trim();

      if (!urlStr || !this.isValidNetworkDriveURL(urlStr)) continue;

      const linkType = this.mapCloudType(fromType, urlStr);
      if (!linkType) continue;

      const password = this.extractPwd(urlStr);
      links.push({ type: linkType, url: urlStr, password });
    }

    return links;
  }

  mapCloudType(apiType, url) {
    const upperType = (apiType || '').toUpperCase();
    const mappedType = API_TYPE_MAP[upperType];
    if (mappedType) {
      const pattern = LINK_PATTERNS[mappedType];
      if (pattern && pattern.test(url)) return mappedType;
      // If mappedType exists but URL doesn't match, still fall through to URL detection
    }

    return this.determineLinkType(url);
  }

  isValidNetworkDriveURL(url) {
    if (!url) return false;
    if (url.includes('javascript:') || url.includes('#')) return false;
    if (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:')) return false;

    for (const pattern of Object.values(LINK_PATTERNS)) {
      if (pattern.test(url)) return true;
    }
    return false;
  }

  determineLinkType(url) {
    if (!url) return '';

    // Keep the same precedence order as Go's switch
    if (LINK_PATTERNS.quark.test(url)) return 'quark';
    if (LINK_PATTERNS.uc.test(url)) return 'uc';
    if (LINK_PATTERNS.baidu.test(url)) return 'baidu';
    if (LINK_PATTERNS.aliyun.test(url)) return 'aliyun';
    if (LINK_PATTERNS.xunlei.test(url)) return 'xunlei';
    if (LINK_PATTERNS.tianyi.test(url)) return 'tianyi';
    if (LINK_PATTERNS['115'].test(url)) return '115';
    if (LINK_PATTERNS.mobile.test(url)) return 'mobile';
    if (LINK_PATTERNS['123'].test(url)) return '123';
    if (LINK_PATTERNS.pikpak.test(url)) return 'pikpak';
    if (LINK_PATTERNS.magnet.test(url)) return 'magnet';
    if (LINK_PATTERNS.ed2k.test(url)) return 'ed2k';

    return '';
  }

  extractPwd(url) {
    const match = url.match(PASSWORD_REGEX);
    return match ? match[1] : '';
  }
}

module.exports = OugePlugin;
