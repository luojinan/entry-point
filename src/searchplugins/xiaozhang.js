const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'xiaozhang';
const BASE_URL = 'https://xzys.fun';
const SEARCH_PATH = '/search.html';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

// Valid pan link patterns
const PAN_PATTERNS = [
  'pan.baidu.com',
  'pan.quark.cn',
  'www.aliyundrive.com',
  'www.alipan.com',
  '115.com',
  'cloud.189.cn',
  'pan.xunlei.com',
  'www.123pan.com',
  'www.jianguoyun.com',
  'cowtransfer.com',
  'weidian.com',
];

// Link type mapping
const LINK_TYPE_MAP = {
  'pan.baidu.com': 'baidu',
  'pan.quark.cn': 'quark',
  'www.aliyundrive.com': 'aliyun',
  'www.alipan.com': 'aliyun',
  '115.com': '115',
  'cloud.189.cn': 'tianyi',
  'pan.xunlei.com': 'xunlei',
  'www.123pan.com': '123',
  'www.jianguoyun.com': 'jianguo',
  'cowtransfer.com': 'cowtransfer',
  'weidian.com': 'weidian',
};

class XiaozhangPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?keyword=${encodeURIComponent(keyword)}`;

    // Send search request
    const resp = await fetchWithRetry(searchURL, {
      headers: { ...HEADERS, 'Referer': BASE_URL },
    }, { timeout: 30000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract search results
    const searchResults = this.extractSearchResults($, keyword);

    // Concurrently fetch detail page links
    const enrichedResults = await this.enrichWithDetailLinks(searchResults, keyword);

    // Filter by keyword
    return filterByKeyword(enrichedResults, keyword);
  }

  extractSearchResults($, keyword) {
    const results = [];

    $('.list-boxes').each((i, el) => {
      const s = $(el);

      // Extract title and detail page link
      const titleElem = s.find('a.text_title_p');
      const title = titleElem.text().trim();
      const detailPath = titleElem.attr('href') || '';

      if (!title || !detailPath) return;

      const detailURL = BASE_URL + detailPath;

      // Extract description
      const content = s.find('p.text_p').text().trim();

      // Extract publish time
      let timeText = s.find('.list-actions span').first().text().trim();
      timeText = timeText.replace(/&nbsp;/g, ' ').trim();

      let datetime = new Date().toISOString();
      if (timeText) {
        const parsed = new Date(timeText);
        if (!isNaN(parsed.getTime())) {
          datetime = parsed.toISOString();
        }
      }

      // Extract resource ID from path
      const idMatch = detailPath.match(/\/subject\/(\d+)\.html/);
      const resourceID = idMatch ? idMatch[1] : String(Date.now());

      results.push({
        uniqueId: `${PLUGIN_NAME}-${resourceID}`,
        title,
        content,
        links: [],
        datetime,
        tags: [],
        channel: '',
        _detailURL: detailURL,
      });
    });

    return results;
  }

  async enrichWithDetailLinks(results, keyword) {
    if (results.length === 0) return results;

    const tasks = results.map(async (result, idx) => {
      try {
        // Stagger requests
        await new Promise(r => setTimeout(r, idx * 50));

        const detailURL = result._detailURL;
        if (!detailURL) return result;

        const links = await this.fetchDetailPageLinks(detailURL, keyword);

        const { _detailURL, ...cleanResult } = result;
        cleanResult.links = links;
        cleanResult.tags = [];
        return cleanResult;
      } catch (e) {
        const { _detailURL, ...cleanResult } = result;
        return cleanResult;
      }
    });

    return Promise.all(tasks);
  }

  async fetchDetailPageLinks(detailURL, keyword) {
    try {
      // First request: check for redirect (follow redirect = false)
      const resp = await fetchWithTimeout(detailURL, {
        headers: { ...HEADERS, 'Referer': BASE_URL },
        redirect: 'manual',
      }, 30000);

      const location = resp.headers.get('location');

      if (!location) {
        // No redirect, might be the actual detail page
        if (resp.ok || resp.status === 200) {
          const html = await resp.text();
          return this.extractLinksFromHTML(html);
        }
        return [];
      }

      // Build real detail page URL
      const realDetailURL = BASE_URL + location;

      // Second request: fetch the real detail page
      const resp2 = await fetchWithRetry(realDetailURL, {
        headers: { ...HEADERS, 'Referer': detailURL },
      }, { timeout: 30000, retries: 1 });

      const html = await resp2.text();
      return this.extractLinksFromHTML(html);
    } catch (e) {
      return [];
    }
  }

  extractLinksFromHTML(htmlContent) {
    const $ = cheerio.load(htmlContent);
    const links = [];
    const linkMap = new Set();

    // Find all links within <p> tags
    $('p').each((i, pEl) => {
      $(pEl).find('a[href]').each((j, aEl) => {
        const href = $(aEl).attr('href') || '';
        if (!href) return;

        // Filter non-pan links
        if (!this.isValidPanLink(href)) return;

        // Deduplicate
        if (linkMap.has(href)) return;
        linkMap.add(href);

        // Extract password from p tag text
        let password = '';
        const pText = $(pEl).text().trim();

        if (pText.includes('提取码') || pText.includes('密码')) {
          const pwdMatch = pText.match(/(?:提取码|密码)[：:]?\s*([a-zA-Z0-9]+)/);
          if (pwdMatch) password = pwdMatch[1];
        }

        // Try extracting password from URL
        if (!password && href.includes('pwd=')) {
          try {
            const urlObj = new URL(href);
            password = urlObj.searchParams.get('pwd') || '';
          } catch (e) {
            // ignore
          }
        }

        const linkType = this.determineLinkType(href);

        links.push({ type: linkType, url: href, password });
      });
    });

    return links;
  }

  isValidPanLink(url) {
    return PAN_PATTERNS.some(pattern => url.includes(pattern));
  }

  determineLinkType(url) {
    for (const [pattern, linkType] of Object.entries(LINK_TYPE_MAP)) {
      if (url.includes(pattern)) return linkType;
    }
    return 'other';
  }
}

module.exports = XiaozhangPlugin;
