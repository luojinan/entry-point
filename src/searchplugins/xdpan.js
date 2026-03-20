const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'xdpan';
const BASE_URL = 'https://xiongdipan.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Referer': BASE_URL + '/',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Cache-Control': 'max-age=0',
};

class XdpanPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    // Step 1: Fetch search results page
    const searchResults = await this.fetchSearchResults(keyword);

    // Step 2: Concurrently fetch detail page info (get real Baidu links)
    await this.enrichWithDetailInfo(searchResults);

    // Step 3: Keyword filter
    return filterByKeyword(searchResults, keyword);
  }

  async fetchSearchResults(keyword) {
    const searchURL = `${BASE_URL}/search?page=1&k=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: HEADERS,
    }, { timeout: 30000, retries: 3 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.extractSearchResults($);
  }

  extractSearchResults($) {
    const results = [];

    $('van-row').each((i, el) => {
      const s = $(el);
      // Check if contains detail page link
      const detailLink = s.find("a[href^='/s/']");
      if (detailLink.length === 0) return;

      const result = this.parseSearchResult($, s);
      if (result && result.title) {
        results.push(result);
      }
    });

    return results;
  }

  parseSearchResult($, s) {
    // Extract detail page link
    const detailLink = s.find("a[href^='/s/']");
    const detailPath = detailLink.attr('href') || '';
    let detailURL = '';
    if (detailPath) {
      detailURL = BASE_URL + detailPath;
    }

    // Extract resource ID
    let resourceID = '';
    if (detailPath) {
      const parts = detailPath.split('/');
      if (parts.length >= 3) {
        resourceID = parts[2];
      }
    }

    // Extract title from content-title div spans
    const titleParts = [];
    s.find("div[name='content-title'] span").each((i, span) => {
      const text = $(span).text().trim();
      if (text) titleParts.push(text);
    });
    let title = titleParts.join('');

    // Fallback: get text directly from content-title
    if (!title) {
      title = s.find("div[name='content-title']").text().trim();
    }

    // Extract time and format info
    const bottomText = s.text();

    let shareTime = '';
    const timeMatch = bottomText.match(/时间:\s*(\d{4}-\d{1,2}-\d{1,2})/);
    if (timeMatch) shareTime = timeMatch[1];

    let fileType = '';
    const formatMatch = bottomText.match(/格式:\s*<b>([^<]+)<\/b>/);
    if (formatMatch) fileType = formatMatch[1];

    // Build content description
    const content = `类型: ${fileType} | 分享时间: ${shareTime} | 详情: ${detailURL}`;

    if (!resourceID) {
      resourceID = String(Date.now());
    }

    return {
      uniqueId: `${PLUGIN_NAME}-${resourceID}`,
      title,
      content,
      links: [],
      datetime: shareTime ? new Date(shareTime).toISOString() : new Date().toISOString(),
      tags: [],
      channel: '',
      _detailURL: detailURL,
    };
  }

  async enrichWithDetailInfo(results) {
    if (results.length === 0) return;

    const tasks = results.map(async (result, index) => {
      try {
        // Stagger requests
        await new Promise(r => setTimeout(r, (index % 3) * 200));

        const detailURL = this.extractDetailURLFromContent(result.content);
        if (!detailURL) return;

        const links = await this.fetchDetailPageLinks(detailURL);
        if (links.length > 0) {
          result.links = links;
        }
      } catch (e) {
        // skip
      }
    });

    await Promise.all(tasks);
  }

  async fetchDetailPageLinks(detailURL) {
    if (!detailURL) return [];

    try {
      const resp = await fetchWithTimeout(detailURL, {
        headers: HEADERS,
      }, 30000);

      if (!resp.ok) return [];

      const html = await resp.text();
      const $ = cheerio.load(html);

      return this.extractDetailPageLinks($);
    } catch (e) {
      return [];
    }
  }

  extractDetailPageLinks($) {
    const links = [];

    // Extract password
    let password = '';
    $('van-cell').each((i, el) => {
      const title = $(el).attr('title') || '';
      if (title === '密码') {
        password = $(el).find('b').text().trim();
      }
    });

    // Extract Baidu link from JavaScript code
    $('script').each((i, el) => {
      const scriptContent = $(el).html() || '';

      // Look for window.open with pan.baidu.com
      const match = scriptContent.match(/window\.open\("([^"]*pan\.baidu\.com[^"]*)"/);
      if (match) {
        let baiduURL = match[1];

        // Append password if not in URL
        if (!baiduURL.includes('pwd=') && password) {
          const separator = baiduURL.includes('?') ? '&' : '?';
          baiduURL = `${baiduURL}${separator}pwd=${password}`;
        }

        links.push({
          type: 'baidu',
          url: baiduURL,
          password,
        });
      }
    });

    return links;
  }

  extractDetailURLFromContent(content) {
    const match = content.match(/详情:\s*(https?:\/\/[^\s]+)/);
    return match ? match[1] : '';
  }
}

module.exports = XdpanPlugin;
