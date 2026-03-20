const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'huban';
const DETAIL_ID_REGEX = /\/id\/(\d+)/;

// Pre-compiled regex patterns for network drive links
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/;
const UC_LINK_REGEX = /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/;
const BAIDU_LINK_REGEX = /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/;
const ALIYUN_LINK_REGEX = /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/;
const XUNLEI_LINK_REGEX = /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/;
const TIANYI_LINK_REGEX = /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/;
const LINK_115_REGEX = /https?:\/\/(115\.com|115cdn\.com)\/s\/[0-9a-zA-Z]+/;
const MOBILE_LINK_REGEX = /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/;
const WEIYUN_LINK_REGEX = /https?:\/\/share\.weiyun\.com\/[0-9a-zA-Z]+/;
const LANZOU_LINK_REGEX = /https?:\/\/(www\.)?(lanzou[uixys]*|lan[zs]o[ux])\.(com|net|org)\/[0-9a-zA-Z]+/;
const JIANGUOYUN_LINK_REGEX = /https?:\/\/(www\.)?jianguoyun\.com\/p\/[0-9a-zA-Z]+/;
const LINK_123_REGEX = /https?:\/\/(123pan\.com|www\.123912\.com|www\.123865\.com|www\.123684\.com)\/s\/[0-9a-zA-Z]+/;
const PIKPAK_LINK_REGEX = /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/;
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/;
const ED2K_LINK_REGEX = /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//;

class HubanPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 2);
  }

  async search(keyword, ext = {}) {
    // 1. Build search URL
    const searchURL = `http://103.45.162.207:20720/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;

    // 2. Send request
    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': 'http://103.45.162.207:20720/',
      },
    }, { timeout: 8000, retries: 1 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Parse search results
    const results = [];
    $('.module-search-item').each((i, el) => {
      const result = this.parseSearchItem($, $(el), keyword);
      if (result && result.uniqueId) {
        results.push(result);
      }
    });

    // 4. Enhance with detail pages
    const enhancedResults = await this.enhanceWithDetails(results);

    // 5. Filter by keyword
    return filterByKeyword(enhancedResults, keyword);
  }

  parseSearchItem($, s, keyword) {
    // Extract detail link and ID
    const detailLink = s.find('.video-info-header h3 a').first().attr('href');
    if (!detailLink) return null;

    const matches = DETAIL_ID_REGEX.exec(detailLink);
    if (!matches || matches.length < 2) return null;
    const itemID = matches[1];

    const uniqueId = `${PLUGIN_NAME}-${itemID}`;

    // Extract title
    const title = s.find('.video-info-header h3 a').first().text().trim();
    if (!title) return null;

    // Extract category
    const category = s.find('.video-info-items').first().find('.video-info-item').first().text().trim();

    // Extract director
    let director = '';
    s.find('.video-info-items').each((i, el) => {
      const titleText = $(el).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('\u5BFC\u6F14')) {
        director = $(el).find('.video-info-item').text().trim();
      }
    });

    // Extract actor
    let actor = '';
    s.find('.video-info-items').each((i, el) => {
      const titleText = $(el).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('\u4E3B\u6F14')) {
        actor = $(el).find('.video-info-item').text().trim();
      }
    });

    // Extract year
    const year = s.find('.video-info-items').last().find('.video-info-item').first().text().trim();

    // Extract quality
    const quality = s.find('.video-info-header .video-info-remarks').text().trim();

    // Extract plot
    let plot = '';
    s.find('.video-info-items').each((i, el) => {
      const titleText = $(el).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('\u5267\u60C5')) {
        plot = $(el).find('.video-info-item').text().trim();
      }
    });

    // Build content
    const contentParts = [];
    if (category) contentParts.push(`\u5206\u7C7B: ${category}`);
    if (director) contentParts.push(`\u5BFC\u6F14: ${director}`);
    if (actor) contentParts.push(`\u4E3B\u6F14: ${actor}`);
    if (quality) contentParts.push(`\u8D28\u91CF: ${quality}`);
    if (plot) contentParts.push(`\u5267\u60C5: ${plot}`);

    // Build tags
    const tags = [];
    if (year) tags.push(year);

    return {
      uniqueId,
      title,
      content: contentParts.join(' | '),
      tags,
      channel: '',
      datetime: '',
      links: [],
      _itemID: itemID,
    };
  }

  async enhanceWithDetails(results) {
    const tasks = results.map(async (result) => {
      const itemID = result._itemID;
      if (!itemID) return result;

      try {
        const links = await this.fetchDetailLinks(itemID);
        const { _itemID, ...cleanResult } = result;
        cleanResult.links = links;
        return cleanResult;
      } catch (e) {
        const { _itemID, ...cleanResult } = result;
        return cleanResult;
      }
    });

    return Promise.all(tasks);
  }

  async fetchDetailLinks(itemID) {
    const detailURL = `http://103.45.162.207:20720/index.php/vod/detail/id/${itemID}.html`;

    try {
      const resp = await fetchWithRetry(detailURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Connection': 'keep-alive',
          'Referer': 'http://103.45.162.207:20720/',
        },
      }, { timeout: 6000, retries: 1 });

      const html = await resp.text();
      const $ = cheerio.load(html);

      const links = [];

      $('#download-list .module-row-one').each((i, el) => {
        const clipboardEl = $(el).find('[data-clipboard-text]');
        const linkURL = clipboardEl.attr('data-clipboard-text');
        if (linkURL && this.isValidNetworkDriveURL(linkURL)) {
          const linkType = this.determineLinkType(linkURL);
          if (linkType) {
            links.push({ type: linkType, url: linkURL, password: '' });
          }
        }
      });

      return links;
    } catch (e) {
      return [];
    }
  }

  isValidNetworkDriveURL(url) {
    if (url.includes('javascript:') || !url) return false;
    if (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:')) return false;

    return QUARK_LINK_REGEX.test(url) || UC_LINK_REGEX.test(url) || BAIDU_LINK_REGEX.test(url) ||
      ALIYUN_LINK_REGEX.test(url) || XUNLEI_LINK_REGEX.test(url) || TIANYI_LINK_REGEX.test(url) ||
      LINK_115_REGEX.test(url) || MOBILE_LINK_REGEX.test(url) || WEIYUN_LINK_REGEX.test(url) ||
      LANZOU_LINK_REGEX.test(url) || JIANGUOYUN_LINK_REGEX.test(url) || LINK_123_REGEX.test(url) ||
      PIKPAK_LINK_REGEX.test(url) || MAGNET_LINK_REGEX.test(url) || ED2K_LINK_REGEX.test(url);
  }

  determineLinkType(url) {
    if (QUARK_LINK_REGEX.test(url)) return 'quark';
    if (UC_LINK_REGEX.test(url)) return 'uc';
    if (BAIDU_LINK_REGEX.test(url)) return 'baidu';
    if (ALIYUN_LINK_REGEX.test(url)) return 'aliyun';
    if (XUNLEI_LINK_REGEX.test(url)) return 'xunlei';
    if (TIANYI_LINK_REGEX.test(url)) return 'tianyi';
    if (LINK_115_REGEX.test(url)) return '115';
    if (MOBILE_LINK_REGEX.test(url)) return 'mobile';
    if (WEIYUN_LINK_REGEX.test(url)) return 'weiyun';
    if (LANZOU_LINK_REGEX.test(url)) return 'lanzou';
    if (JIANGUOYUN_LINK_REGEX.test(url)) return 'jianguoyun';
    if (LINK_123_REGEX.test(url)) return '123';
    if (PIKPAK_LINK_REGEX.test(url)) return 'pikpak';
    if (MAGNET_LINK_REGEX.test(url)) return 'magnet';
    if (ED2K_LINK_REGEX.test(url)) return 'ed2k';
    return '';
  }
}

module.exports = HubanPlugin;
