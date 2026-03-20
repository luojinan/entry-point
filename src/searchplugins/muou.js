const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const BASE_URL = 'https://666.666291.xyz';
const detailIDRegex = /\/vod\/detail\/id\/(\d+)\.html/;

// Network drive link regexes (supporting 16 types)
const linkRegexMap = [
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

class MuouPlugin extends BasePlugin {
  constructor() {
    super('muou', 2);
  }

  /**
   * Search for resources
   * @param {string} keyword
   * @param {object} ext
   * @returns {Promise<Array>}
   */
  async search(keyword, ext = {}) {
    // 1. Build search URL
    const searchURL = `${BASE_URL}/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;

    // 2. Send search request
    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': `${BASE_URL}/`,
      },
    }, { timeout: 8000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Extract search results
    const results = [];
    $('.module-search-item').each((i, el) => {
      const s = $(el);
      const parsed = this._parseSearchItem($, s);
      if (parsed && parsed.uniqueId) {
        results.push(parsed);
      }
    });

    // 4. Fetch detail pages concurrently
    const enhanced = await this._enhanceWithDetails(results);

    // 5. Filter by keyword
    return filterByKeyword(enhanced, keyword);
  }

  /**
   * Parse a single search result item
   */
  _parseSearchItem($, s) {
    // Extract detail link
    const detailLink = s.find('.video-info-header h3 a').first().attr('href');
    if (!detailLink) return null;

    // Extract ID
    const matches = detailIDRegex.exec(detailLink);
    if (!matches || matches.length < 2) return null;

    const itemID = matches[1];
    const uniqueId = `${this.name}-${itemID}`;

    // Extract title
    const title = s.find('.video-info-header h3 a').text().trim();

    // Extract quality
    const quality = s.find('.video-serial').text().trim();

    // Extract tags
    const tags = [];
    s.find('.video-info-aux .tag-link a').each((i, tag) => {
      const tagText = $(tag).text().trim();
      if (tagText) tags.push(tagText);
    });

    // Extract director
    let director = '';
    s.find('.video-info-items').each((i, item) => {
      const titleText = $(item).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('导演')) {
        director = $(item).find('.video-info-actor a').text().trim();
      }
    });

    // Extract actors
    const actors = [];
    s.find('.video-info-items').each((i, item) => {
      const titleText = $(item).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('主演')) {
        $(item).find('.video-info-actor a').each((j, actor) => {
          const actorName = $(actor).text().trim();
          if (actorName) actors.push(actorName);
        });
      }
    });

    // Extract plot
    let plot = '';
    s.find('.video-info-items').each((i, item) => {
      const titleText = $(item).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('剧情')) {
        plot = $(item).find('.video-info-item').text().trim();
      }
    });

    // Build content description
    const contentParts = [];
    if (quality) contentParts.push(`【${quality}】`);
    if (director) contentParts.push(`导演：${director}`);
    if (actors.length > 0) {
      let actorStr = actors.slice(0, 3).join('、');
      if (actors.length > 3) actorStr += '等';
      contentParts.push(`主演：${actorStr}`);
    }
    if (plot) contentParts.push(plot);

    return {
      uniqueId,
      title,
      content: contentParts.join('\n'),
      links: [],
      datetime: '',
      tags,
      channel: '',
      _itemID: itemID,
    };
  }

  /**
   * Fetch detail pages concurrently to get download links
   */
  async _enhanceWithDetails(results) {
    const tasks = results.map(async (r) => {
      try {
        const links = await this._fetchDetailLinks(r._itemID);
        r.links = links;
      } catch (e) {
        // ignore
      }
      delete r._itemID;
      return r;
    });

    return Promise.all(tasks);
  }

  /**
   * Fetch detail page and extract download links
   */
  async _fetchDetailLinks(itemID) {
    const detailURL = `${BASE_URL}/index.php/vod/detail/id/${itemID}.html`;

    const resp = await fetchWithRetry(detailURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': `${BASE_URL}/`,
      },
    }, { timeout: 6000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    const links = [];
    const seen = new Set();

    $('#download-list .module-row-one').each((i, el) => {
      const s = $(el);

      // From data-clipboard-text attribute
      const clipboardText = s.find('[data-clipboard-text]').attr('data-clipboard-text');
      if (clipboardText && this._isValidURL(clipboardText)) {
        const linkType = this._determineLinkType(clipboardText);
        if (linkType && !seen.has(clipboardText)) {
          seen.add(clipboardText);
          links.push({ type: linkType, url: clipboardText, password: '' });
        }
      }

      // Also check direct href attributes
      s.find('a[href]').each((j, a) => {
        const href = $(a).attr('href');
        if (href && this._isValidURL(href)) {
          const linkType = this._determineLinkType(href);
          if (linkType && !seen.has(href)) {
            seen.add(href);
            links.push({ type: linkType, url: href, password: '' });
          }
        }
      });
    });

    return links;
  }

  /**
   * Check if URL is a valid network drive URL
   */
  _isValidURL(url) {
    if (!url || url.includes('javascript:') || url.includes('#')) return false;
    if (!url.startsWith('http') && !url.startsWith('magnet:') && !url.startsWith('ed2k:')) return false;

    for (const { reg } of linkRegexMap) {
      if (reg.test(url)) return true;
    }
    return false;
  }

  /**
   * Determine link type from URL
   */
  _determineLinkType(url) {
    for (const { reg, type } of linkRegexMap) {
      if (reg.test(url)) return type;
    }
    return '';
  }
}

module.exports = MuouPlugin;
