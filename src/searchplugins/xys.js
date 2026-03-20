/**
 * xys - 小云搜索插件
 * 小云搜索 - 阿里云盘、夸克网盘、百度网盘等多网盘搜索引擎
 */

const cheerio = require('cheerio');
const { BasePlugin, generateUniqueID, cleanHTML, determineCloudType, fetchWithRetry, filterByKeyword } = require('./base');

const BASE_URL = 'https://www.yunso.net';
const TOKEN_PATH = '/index/user/s';
const SEARCH_PATH = '/api/validate/searchX2';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RESULTS = 50;

class Xys extends BasePlugin {
  constructor() {
    super('xys', 3);
    this._tokenCache = null;
    this._tokenTimestamp = 0;
    this._cacheTTL = 30 * 60 * 1000; // 30 minutes
  }

  async search(keyword, ext = {}) {
    // Step 1: get token
    const token = await this._getToken(keyword);

    // Step 2: execute search
    const results = await this._executeSearch(token, keyword);

    return results;
  }

  async _getToken(keyword) {
    // Check cache
    if (this._tokenCache && (Date.now() - this._tokenTimestamp) < this._cacheTTL) {
      return this._tokenCache;
    }

    const tokenURL = `${BASE_URL}${TOKEN_PATH}?wd=${encodeURIComponent(keyword)}&mode=undefined&stype=undefined`;

    const resp = await fetchWithRetry(tokenURL, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': BASE_URL + '/',
      },
    }, { timeout: 30000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    let token = '';
    $('script').each((i, el) => {
      const scriptContent = $(el).html() || '';
      if (scriptContent.includes('DToken')) {
        const match = scriptContent.match(/const\s+DToken\s*=\s*"([^"]+)"/);
        if (match) {
          token = match[1];
        }
      }
    });

    if (!token) {
      throw new Error('未找到DToken');
    }

    // Cache token
    this._tokenCache = token;
    this._tokenTimestamp = Date.now();

    return token;
  }

  async _executeSearch(token, keyword) {
    const searchURL = `${BASE_URL}${SEARCH_PATH}?DToken2=${token}&requestID=undefined&mode=90002&stype=undefined&scope_content=0&wd=${encodeURIComponent(keyword)}&uk=&page=1&limit=20&screen_filetype=`;

    const resp = await fetchWithRetry(searchURL, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': BASE_URL + '/',
        'Origin': BASE_URL,
        'X-Requested-With': 'XMLHttpRequest',
      },
    }, { timeout: 30000, retries: 2 });

    const json = await resp.json();

    if (json.code !== 0) {
      throw new Error(`搜索API返回错误: ${json.msg}`);
    }

    return this._parseSearchResults(json.data, keyword);
  }

  _parseSearchResults(htmlData, keyword) {
    const $ = cheerio.load(htmlData);
    const results = [];

    $('.layui-card[data-qid]').each((i, el) => {
      if (results.length >= MAX_RESULTS) return;

      const s = $(el);
      const result = this._parseResultItem(s, i + 1);
      if (result) {
        results.push(result);
      }
    });

    return filterByKeyword(results, keyword);
  }

  _parseResultItem(s, index) {
    const qid = s.attr('data-qid');
    if (!qid) return null;

    const linkEl = s.find('a[onclick="open_sid(this)"]');
    if (linkEl.length === 0) return null;

    const title = this._cleanTitle(linkEl.text());
    if (!title) return null;

    let href = linkEl.attr('href') || '';
    if (!href) {
      const urlAttr = linkEl.attr('url');
      if (urlAttr) {
        try {
          href = Buffer.from(urlAttr, 'base64').toString('utf-8');
        } catch (e) {
          // ignore decode error
        }
      }
    }

    if (!href) return null;

    const password = linkEl.attr('pa') || '';

    // Extract time
    const timeParent = s.find('.layui-icon-time').parent();
    const timeStr = (timeParent.text() || '').trim();
    const datetime = this._parseTime(timeStr);

    // Extract platform type
    const platform = determineCloudType(href);

    return {
      uniqueId: `${this.name}-${qid}-${index}`,
      title,
      content: `来源：${platform}`,
      links: [{
        type: platform,
        url: href,
        password,
      }],
      datetime,
      tags: [platform],
      channel: '',
    };
  }

  _cleanTitle(title) {
    if (!title) return '';
    let cleaned = title.replace(/<[^>]*>/g, '');
    cleaned = cleaned.replace(/@/g, '');
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    return cleaned;
  }

  _parseTime(timeStr) {
    if (!timeStr) return new Date();
    const match = timeStr.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (match) {
      const d = new Date(match[1]);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }
}

module.exports = Xys;
