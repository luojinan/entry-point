const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.libvio.mov';
const SEARCH_PATH = '/search/-------------.html';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

class LibvioPlugin extends BasePlugin {
  constructor() {
    super('libvio', 1);
  }

  /**
   * Search for resources
   * @param {string} keyword
   * @param {object} ext
   * @returns {Promise<Array>}
   */
  async search(keyword, ext = {}) {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?wd=${encodeURIComponent(keyword)}&submit=`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': BASE_URL,
    };

    const resp = await fetchWithRetry(searchURL, { headers }, { timeout: 10000, retries: 2 });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract search results
    const results = [];
    const detailIdRegex = /\/detail\/(\d+)\.html/;

    $('ul.stui-vodlist li').each((i, el) => {
      const s = $(el);

      // Extract title and detail link
      const titleElem = s.find('.stui-vodlist__detail h4 a');
      let title = titleElem.text().trim();
      if (!title) title = titleElem.attr('title') || '';

      let detailPath = titleElem.attr('href') || '';
      if (!detailPath) {
        detailPath = s.find('a.stui-vodlist__thumb').attr('href') || '';
      }

      if (!title || !detailPath) return;

      const detailURL = BASE_URL + detailPath;

      // Extract extra info
      const episodeInfo = s.find('.pic-text').text().trim();
      const rating = s.find('.pic-tag').text().trim();

      // Extract ID
      const idMatch = detailIdRegex.exec(detailPath);
      const resourceID = idMatch ? idMatch[1] : `${Date.now()}`;

      // Build content
      let content = '';
      if (episodeInfo) content = episodeInfo;
      if (rating) {
        if (content) content += ' | ';
        content += '评分: ' + rating;
      }

      results.push({
        uniqueId: `${this.name}-${resourceID}`,
        title,
        content,
        links: [],
        datetime: '',
        tags: [],
        channel: '',
        _detailURL: detailURL,
      });
    });

    // Fetch detail pages for download links concurrently
    await this._enrichWithDetailLinks(results, headers, keyword);

    // Filter by keyword
    const filtered = filterByKeyword(results, keyword);

    // Clean up internal fields
    filtered.forEach(r => delete r._detailURL);

    return filtered;
  }

  /**
   * Fetch detail pages concurrently
   */
  async _enrichWithDetailLinks(results, headers, keyword) {
    const tasks = results.map(async (r, idx) => {
      try {
        // Small delay to avoid too many requests
        await new Promise(resolve => setTimeout(resolve, idx * 50));

        const links = await this._fetchDetailPageLinks(r._detailURL, headers, keyword);
        r.links = links;
      } catch (e) {
        // ignore errors
      }
    });

    await Promise.all(tasks);
  }

  /**
   * Fetch detail page and extract play/download links
   */
  async _fetchDetailPageLinks(detailURL, headers, keyword) {
    const resp = await fetchWithRetry(detailURL, {
      headers: { ...headers, Referer: BASE_URL },
    }, { timeout: 10000, retries: 1 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract download play links (only those containing "下载")
    const playLinks = [];

    $('.stui-vodlist__head').each((i, el) => {
      const s = $(el);
      const title = s.find('h3').text().trim();

      // Only process sources that contain "下载"
      if (!title.includes('下载')) return;

      // Extract pan type from title
      let panType = '';
      if (title.includes('夸克') || title.toLowerCase().includes('quark')) panType = 'quark';
      else if (title.includes('UC') || title.toLowerCase().includes('uc')) panType = 'uc';
      else if (title.includes('百度') || title.toLowerCase().includes('baidu')) panType = 'baidu';

      // Get first playlist link
      const firstLink = s.find('.stui-content__playlist li a').first();
      if (firstLink.length > 0) {
        const href = firstLink.attr('href');
        if (href) {
          playLinks.push({
            url: BASE_URL + href,
            panType,
          });
        }
      }
    });

    if (playLinks.length === 0) return [];

    // Fetch actual pan links from play pages
    const links = [];
    for (const playLink of playLinks) {
      try {
        const panLink = await this._fetchPanLink(playLink.url, detailURL, headers);
        if (panLink) links.push(panLink);
      } catch (e) {
        // ignore errors
      }
    }

    return links;
  }

  /**
   * Fetch a play page to extract the actual pan link from player_aaaa
   */
  async _fetchPanLink(playURL, referer, headers) {
    const resp = await fetchWithRetry(playURL, {
      headers: { ...headers, Referer: referer },
    }, { timeout: 10000, retries: 1 });

    const body = await resp.text();

    // Extract player_aaaa object
    const playerDataRegex = /var\s+player_aaaa\s*=\s*(\{[^}]+\})/;
    const matches = playerDataRegex.exec(body);
    if (!matches || matches.length < 2) return null;

    // Parse JSON (handle escaped slashes)
    let playerJSON = matches[1].replace(/\\\//g, '/');
    let playerData;
    try {
      playerData = JSON.parse(playerJSON);
    } catch (e) {
      return null;
    }

    const panURL = playerData.url;
    if (!panURL) return null;

    const from = playerData.from || '';
    const linkType = this._mapPanType(from, panURL);

    return { type: linkType, url: panURL, password: '' };
  }

  /**
   * Map pan type based on 'from' field and URL
   */
  _mapPanType(from, url) {
    // First check from field
    switch (from.toLowerCase()) {
      case 'uc': return 'uc';
      case 'quark': return 'quark';
      case 'baidu': return 'baidu';
      case 'aliyun': case 'alipan': return 'aliyun';
      case 'xunlei': case 'thunder': return 'xunlei';
      case '115': return '115';
      case '123': case '123pan': return '123';
    }

    // Then check URL
    const lowerURL = url.toLowerCase();
    if (lowerURL.includes('drive.uc.cn')) return 'uc';
    if (lowerURL.includes('pan.quark.cn')) return 'quark';
    if (lowerURL.includes('pan.baidu.com')) return 'baidu';
    if (lowerURL.includes('alipan.com') || lowerURL.includes('aliyundrive.com')) return 'aliyun';
    if (lowerURL.includes('pan.xunlei.com')) return 'xunlei';
    if (lowerURL.includes('115.com')) return '115';
    if (lowerURL.includes('123pan.com') || lowerURL.includes('123684.com')) return '123';
    if (lowerURL.includes('cloud.189.cn')) return 'tianyi';

    return 'others';
  }
}

module.exports = LibvioPlugin;
