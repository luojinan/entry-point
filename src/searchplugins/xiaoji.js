const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'xiaoji';
const BASE_URL = 'https://www.xiaojitv.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Referer': BASE_URL + '/',
  'Cache-Control': 'max-age=0',
  'Upgrade-Insecure-Requests': '1',
};

// Pre-compiled regex patterns
const DETAIL_ID_REGEX = /\/(\d+)\.html/;
const GO_LINK_REGEX = /\/go\.html\?url=([A-Za-z0-9+/]+=*)/;

class XiaojiPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    const searchURL = `${BASE_URL}/?s=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: HEADERS,
    }, { timeout: 10000, retries: 3 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Parse search results (including detail page fetching)
    const results = await this.parseSearchResults($, keyword);

    // Keyword filter
    return filterByKeyword(results, keyword);
  }

  async parseSearchResults($, keyword) {
    const items = [];

    $('article.poster-item').each((i, el) => {
      const item = this.parseSearchResultItem($, $(el), keyword);
      if (item) items.push(item);
    });

    // Concurrently fetch detail page links for all items
    const tasks = items.map(async (item) => {
      try {
        const links = await this.fetchDetailPageLinks(item._detailURL);
        if (links.length > 0) {
          const { _detailURL, ...cleanItem } = item;
          cleanItem.links = links;
          return cleanItem;
        }
      } catch (e) {
        // skip
      }
      // Return item even without links (with empty links)
      const { _detailURL, ...cleanItem } = item;
      return cleanItem;
    });

    const results = await Promise.all(tasks);
    return results.filter(r => r.links.length > 0);
  }

  parseSearchResultItem($, s, keyword) {
    // Extract detail page link
    const detailLink = s.find('.poster-link').attr('href');
    if (!detailLink) return null;

    const fullDetailLink = detailLink.startsWith('/') ? BASE_URL + detailLink : detailLink;

    // Extract resource ID
    const idMatch = fullDetailLink.match(DETAIL_ID_REGEX);
    if (!idMatch) return null;
    const resourceID = idMatch[1];

    // Extract title
    const title = s.find('.poster-title a').text().trim();
    if (!title) return null;

    // Extract rating
    const rating = s.find('.rating-score').text().trim();

    // Extract category
    const category = s.find('.poster-category a').text().trim();

    // Extract tags
    const tags = [];
    s.find('.poster-tags a').each((i, tagEl) => {
      const tag = $(tagEl).text().trim();
      if (tag) tags.push(tag);
    });

    // Build content
    let content = `分类: ${category}`;
    if (rating) content += ` | 评分: ${rating}`;
    if (tags.length > 0) content += ` | 标签: ${tags.join(', ')}`;

    return {
      uniqueId: `${PLUGIN_NAME}-${resourceID}`,
      title,
      content,
      links: [],
      datetime: new Date().toISOString(),
      tags,
      channel: '',
      _detailURL: fullDetailLink,
    };
  }

  async fetchDetailPageLinks(detailURL) {
    try {
      const resp = await fetchWithRetry(detailURL, {
        headers: HEADERS,
      }, { timeout: 8000, retries: 3 });

      const html = await resp.text();
      const $ = cheerio.load(html);

      return this.parseDetailPageLinks($);
    } catch (e) {
      return [];
    }
  }

  parseDetailPageLinks($) {
    const links = [];
    const seenLinks = new Set();

    // Find links in resource-compact-link area
    $('.resource-compact-link a').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      let realURL = '';

      // Check if go.html format (needs base64 decode)
      if (href.includes('/go.html?url=')) {
        realURL = this.decodeGoLink(href);
      } else if (href.startsWith('http://') || href.startsWith('https://') ||
                 href.startsWith('magnet:') || href.startsWith('ed2k://')) {
        realURL = href;
      }

      // Process valid link
      if (this.isValidURL(realURL) && !seenLinks.has(realURL)) {
        const linkType = this.determineCloudTypeLocal(realURL);
        links.push({ type: linkType, url: realURL, password: '' });
        seenLinks.add(realURL);
      }
    });

    return links;
  }

  decodeGoLink(goLink) {
    const match = goLink.match(GO_LINK_REGEX);
    if (!match) return '';

    let encoded = match[1].trim();
    if (!encoded) return '';

    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
      if (this.isValidURL(decoded)) return decoded;
    } catch (e) {
      // Try fixing padding
      encoded = encoded.replace(/ /g, '+');
      const paddingNeeded = (4 - (encoded.length % 4)) % 4;
      encoded += '='.repeat(paddingNeeded);
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
        if (this.isValidURL(decoded)) return decoded;
      } catch (e2) {
        // ignore
      }
    }

    return '';
  }

  isValidURL(urlStr) {
    if (!urlStr) return false;
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      if (urlStr.length <= 8) return false;
      return urlStr.substring(8).includes('.');
    }
    if (urlStr.startsWith('magnet:')) {
      return urlStr.length > 7 && urlStr.includes('xt=');
    }
    if (urlStr.startsWith('ed2k://')) {
      return urlStr.length > 7;
    }
    return false;
  }

  determineCloudTypeLocal(url) {
    if (url.includes('pan.quark.cn')) return 'quark';
    if (url.includes('drive.uc.cn')) return 'uc';
    if (url.includes('pan.baidu.com')) return 'baidu';
    if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
    if (url.includes('pan.xunlei.com')) return 'xunlei';
    if (url.includes('cloud.189.cn')) return 'tianyi';
    if (url.includes('115.com') || url.includes('115cdn.com')) return '115';
    if (url.includes('123pan.com')) return '123';
    if (url.includes('caiyun.139.com')) return 'mobile';
    if (url.includes('mypikpak.com')) return 'pikpak';
    if (url.includes('magnet:')) return 'magnet';
    if (url.includes('ed2k://')) return 'ed2k';
    return 'others';
  }
}

module.exports = XiaojiPlugin;
