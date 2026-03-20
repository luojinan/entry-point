const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'kkv';
const BASE_URL = 'http://kkv.q-23.cn';
const SEARCH_PATH = '/';
const MAX_RESULTS = 10;

const PWD_PATTERNS = [
  /\u63D0\u53D6\u7801[：:]\s*([a-zA-Z0-9]{4})/,
  /\u5BC6\u7801[：:]\s*([a-zA-Z0-9]{4})/,
  /pwd[：:]\s*([a-zA-Z0-9]{4})/,
];

class KkvPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?s=${encodeURIComponent(keyword)}`;

    // Step 1: Fetch search results
    const items = await this.fetchSearchResults(searchURL);

    if (items.length === 0) return [];

    // Step 2: Filter by keyword
    const filteredItems = this.filterItemsByKeyword(items, keyword);
    if (filteredItems.length === 0) return [];

    // Step 3: Limit results
    const limitedItems = filteredItems.slice(0, MAX_RESULTS);

    // Step 4: Process detail pages concurrently
    return this.processDetailPages(limitedItems);
  }

  async fetchSearchResults(searchURL) {
    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': BASE_URL,
      },
    }, { timeout: 30000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    const items = [];

    $('article.post').each((i, el) => {
      const s = $(el);
      const link = s.find('.entry-header h2.entry-title a');
      const href = link.attr('href');
      if (!href) return;

      const title = link.text().trim();
      if (!title) return;

      const idMatch = href.match(/\?p=(\d+)/);
      if (!idMatch || idMatch.length < 2) return;

      items.push({
        id: idMatch[1],
        title,
        detailURL: href,
      });
    });

    return items;
  }

  filterItemsByKeyword(items, keyword) {
    const lowerKeyword = keyword.toLowerCase();
    return items.filter(item => item.title.toLowerCase().includes(lowerKeyword));
  }

  async processDetailPages(items) {
    const tasks = items.map(async (item) => {
      try {
        return await this.processDetailPage(item);
      } catch (e) {
        return null;
      }
    });

    const settled = await Promise.all(tasks);
    return settled.filter(Boolean);
  }

  async processDetailPage(item) {
    const resp = await fetchWithRetry(item.detailURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': BASE_URL,
      },
    }, { timeout: 30000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract title
    let title = $('.entry-header h1.entry-title').text().trim();
    if (!title) title = item.title;

    // Extract description
    let description = '';
    $('.entry-content p').first().each((i, el) => {
      description = $(el).text().trim();
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }
    });

    // Extract update time
    const updateTime = this.extractUpdateTime($);

    // Extract pan links
    const panLinks = this.extractPanLinks($);
    if (panLinks.length === 0) return null;

    return {
      uniqueId: `${PLUGIN_NAME}-${item.id}`,
      title,
      content: description,
      links: panLinks,
      channel: '',
      datetime: updateTime,
      tags: [],
    };
  }

  extractUpdateTime($) {
    const timeStr = $('time.updated').attr('datetime');
    if (!timeStr) return new Date().toISOString();

    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();

    return new Date().toISOString();
  }

  extractPanLinks($) {
    const links = [];

    $('.entry-content p').each((i, pEl) => {
      const s = $(pEl);
      s.find('a').each((j, aEl) => {
        const href = ($(aEl).attr('href') || '').trim();
        const cloudType = this.determinePanType(href);
        if (!cloudType) return;

        const password = this.extractPasswordFromContext(href, s.text());

        links.push({
          type: cloudType,
          url: href,
          password,
        });
      });
    });

    return links;
  }

  determinePanType(panURL) {
    const lower = (panURL || '').toLowerCase();

    if (lower.includes('pan.baidu.com')) return 'baidu';
    if (lower.includes('pan.quark.cn')) return 'quark';
    if (lower.includes('drive.uc.cn')) return 'uc';
    if (lower.includes('pan.xunlei.com')) return 'xunlei';
    if (lower.includes('aliyundrive.com') || lower.includes('alipan.com')) return 'aliyun';
    if (lower.includes('cloud.189.cn')) return 'tianyi';
    if (lower.includes('115.com') || lower.includes('115cdn.com') || lower.includes('anxia.com')) return '115';
    if (lower.includes('123684.com') || lower.includes('123685.com') ||
        lower.includes('123912.com') || lower.includes('123pan.com') ||
        lower.includes('123pan.cn') || lower.includes('123592.com')) return '123';
    if (lower.includes('caiyun.139.com')) return 'mobile';
    if (lower.includes('mypikpak.com')) return 'pikpak';

    return '';
  }

  extractPasswordFromContext(panURL, contextText) {
    // Try extracting pwd from URL query parameters
    try {
      const urlObj = new URL(panURL);
      const pwd = urlObj.searchParams.get('pwd');
      if (pwd && pwd.length === 4) return pwd;
    } catch (e) {
      // URL parse failed, try regex on URL
      const pwdMatch = panURL.match(/[?&]pwd=([a-zA-Z0-9]{4})/);
      if (pwdMatch) return pwdMatch[1];
    }

    // Try patterns on context text
    for (const pattern of PWD_PATTERNS) {
      const matches = pattern.exec(contextText);
      if (matches && matches.length > 1) return matches[1];
    }

    return '';
  }
}

module.exports = KkvPlugin;
