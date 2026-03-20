/**
 * zhizhen - 知真影视插件
 * 搜索影视资源，从详情页提取多种网盘下载链接
 */

const cheerio = require('cheerio');
const { BasePlugin, fetchWithRetry, filterByKeyword } = require('./base');

const DETAIL_ID_REGEX = /\/vod\/detail\/id\/(\d+)\.html/;
const PASSWORD_REGEX = /\?pwd=([0-9a-zA-Z]+)/;

// Pre-compiled link regexes for 16 types of network drive links
const LINK_REGEXES = [
  { reg: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/, type: 'quark' },
  { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/, type: 'uc' },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/, type: 'baidu' },
  { reg: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/, type: 'aliyun' },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(\?pwd=[0-9a-zA-Z]+)?/, type: 'xunlei' },
  { reg: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/, type: 'tianyi' },
  { reg: /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/, type: '115' },
  { reg: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/, type: 'mobile' },
  { reg: /https?:\/\/share\.weiyun\.com\/[0-9a-zA-Z]+/, type: 'weiyun' },
  { reg: /https?:\/\/(www\.)?(lanzou[uixys]*|lan[zs]o[ux])\.(com|net|org)\/[0-9a-zA-Z]+/, type: 'lanzou' },
  { reg: /https?:\/\/(www\.)?jianguoyun\.com\/p\/[0-9a-zA-Z]+/, type: 'jianguoyun' },
  { reg: /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/, type: '123' },
  { reg: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/, type: 'pikpak' },
  { reg: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/, type: 'magnet' },
  { reg: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//, type: 'ed2k' },
];

const MAX_CONCURRENCY = 20;

class Zhizhen extends BasePlugin {
  constructor() {
    super('zhizhen', 1);
  }

  async search(keyword, ext = {}) {
    // 1. Build search URL
    const searchURL = `https://xiaomi666.fun/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;

    // 2. Send request
    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://xiaomi666.fun/',
      },
    }, { timeout: 8000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Parse search results
    const searchItems = [];
    $('.module-search-item').each((i, el) => {
      const item = this._parseSearchItem($, $(el));
      if (item && item.uniqueId) {
        searchItems.push(item);
      }
    });

    // 4. Enhance with detail pages (fetch links)
    const results = await this._enhanceWithDetails(searchItems);

    // 5. Filter by keyword
    return filterByKeyword(results, keyword);
  }

  _parseSearchItem($, s) {
    const detailLink = s.find('.video-info-header h3 a').first().attr('href');
    if (!detailLink) return null;

    const matches = detailLink.match(DETAIL_ID_REGEX);
    if (!matches) return null;

    const itemID = matches[1];
    const title = (s.find('.video-info-header h3 a').text() || '').trim();

    // Extract quality
    const quality = (s.find('.video-serial').text() || '').trim();

    // Extract tags
    const tags = [];
    s.find('.video-info-aux .tag-link a').each((_, tag) => {
      const tagText = ($(tag).text() || '').trim();
      if (tagText) tags.push(tagText);
    });

    // Extract director
    let director = '';
    s.find('.video-info-items').each((_, item) => {
      const itemTitle = ($(item).find('.video-info-itemtitle').text() || '').trim();
      if (itemTitle.includes('导演')) {
        director = ($(item).find('.video-info-actor a').text() || '').trim();
      }
    });

    // Extract actors
    const actors = [];
    s.find('.video-info-items').each((_, item) => {
      const itemTitle = ($(item).find('.video-info-itemtitle').text() || '').trim();
      if (itemTitle.includes('主演')) {
        $(item).find('.video-info-actor a').each((_, actor) => {
          const actorName = ($(actor).text() || '').trim();
          if (actorName) actors.push(actorName);
        });
      }
    });

    // Extract plot
    let plot = '';
    s.find('.video-info-items').each((_, item) => {
      const itemTitle = ($(item).find('.video-info-itemtitle').text() || '').trim();
      if (itemTitle.includes('剧情')) {
        plot = ($(item).find('.video-info-item').text() || '').trim();
      }
    });

    // Build content
    const contentParts = [];
    if (quality) contentParts.push('【' + quality + '】');
    if (director) contentParts.push('导演：' + director);
    if (actors.length > 0) {
      let actorStr = actors.slice(0, 3).join('、');
      if (actors.length > 3) actorStr += '等';
      contentParts.push('主演：' + actorStr);
    }
    if (plot) contentParts.push(plot);

    return {
      uniqueId: `${this.name}-${itemID}`,
      title,
      content: contentParts.join('\n'),
      links: [],
      tags,
      datetime: null,
      channel: '',
      _itemID: itemID,
    };
  }

  async _enhanceWithDetails(searchItems) {
    const results = [];

    for (let i = 0; i < searchItems.length; i += MAX_CONCURRENCY) {
      const batch = searchItems.slice(i, i + MAX_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const links = await this._fetchDetailLinks(item._itemID);
          return { ...item, links };
        })
      );

      for (const res of batchResults) {
        if (res.status === 'fulfilled' && res.value) {
          const { _itemID, ...result } = res.value;
          results.push(result);
        }
      }
    }

    return results;
  }

  async _fetchDetailLinks(itemID) {
    const detailURL = `https://xiaomi666.fun/index.php/vod/detail/id/${itemID}.html`;

    const resp = await fetchWithRetry(detailURL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': 'https://xiaomi666.fun/',
      },
    }, { timeout: 6000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    const links = [];
    const seenURLs = new Set();

    // Find download links area
    $('#download-list .module-row-one').each((_, el) => {
      const s = $(el);

      // From data-clipboard-text attribute
      const clipboardURL = s.find('[data-clipboard-text]').attr('data-clipboard-text');
      if (clipboardURL && this._isValidNetworkDriveURL(clipboardURL)) {
        const linkType = this._determineLinkType(clipboardURL);
        if (linkType && !seenURLs.has(clipboardURL)) {
          links.push({ type: linkType, url: clipboardURL, password: '' });
          seenURLs.add(clipboardURL);
        }
      }

      // From href attributes
      s.find('a[href]').each((_, a) => {
        const linkURL = $(a).attr('href');
        if (linkURL && this._isValidNetworkDriveURL(linkURL)) {
          const linkType = this._determineLinkType(linkURL);
          if (linkType && !seenURLs.has(linkURL)) {
            links.push({ type: linkType, url: linkURL, password: '' });
            seenURLs.add(linkURL);
          }
        }
      });
    });

    return links;
  }

  _isValidNetworkDriveURL(url) {
    if (!url) return false;
    if (url.includes('javascript:') || url.includes('#')) return false;
    if (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:')) return false;

    return LINK_REGEXES.some(({ reg }) => reg.test(url));
  }

  _determineLinkType(url) {
    for (const { reg, type } of LINK_REGEXES) {
      if (reg.test(url)) return type;
    }
    return '';
  }

  _extractPassword(url) {
    const matches = url.match(PASSWORD_REGEX);
    return matches ? matches[1] : '';
  }
}

module.exports = Zhizhen;
