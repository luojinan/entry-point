const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const crypto = require('crypto');

const API_URL = 'https://nsthwj.com/thwj/game/query';
const PAGE_SIZE = 1000;

// Pre-compiled regex patterns
const urlRegex = /https?:\/\/[^\s]+/;
const baiduLinkRegex = /https:\/\/pan\.baidu\.com\/s\/[^?\s]+/;
const baiduPwdRegex = /\?pwd=([a-zA-Z0-9]+)/;

class NsgamePlugin extends BasePlugin {
  constructor() {
    super('nsgame', 2);
  }

  /**
   * Search for resources
   * @param {string} keyword
   * @param {object} ext
   * @returns {Promise<Array>}
   */
  async search(keyword, ext = {}) {
    // 1. Build search URL
    const searchURL = `${API_URL}?pageNum=1&pageSize=${PAGE_SIZE}&type=&queryName=${encodeURIComponent(keyword)}`;

    // 2. Send request
    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://nsthwj.com/',
      },
    }, { timeout: 10000, retries: 2 });

    const body = await resp.json();

    // 3. Check response status
    if (!body.success || body.code !== '200') {
      throw new Error(`[${this.name}] API error: success=${body.success}, code=${body.code}`);
    }

    // 4. Convert to standard format
    const results = [];
    const items = (body.data && body.data.pageData && body.data.pageData.data) || [];

    for (const item of items) {
      // Parse network drive links
      const links = this._parseLinks(item.url || '');
      if (links.length === 0) continue;

      // Generate unique ID
      const uniqueId = this._generateUniqueID(item.name || '');

      // Build title with version info
      let title = item.name || '';
      if (item.password) {
        const versionInfo = item.password.replace(/\n/g, ' ');
        title = `${item.name}（${versionInfo}）`;
      }

      results.push({
        uniqueId,
        title,
        content: item.password || '',
        links,
        datetime: new Date().toISOString(),
        tags: ['NS游戏', 'Switch'],
        channel: '',
      });
    }

    // 5. Filter by keyword
    return filterByKeyword(results, keyword);
  }

  /**
   * Parse URL field containing multiple network drive links
   */
  _parseLinks(urlText) {
    const links = [];
    const lines = urlText.split('\n');

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.includes('[夸克网盘]')) {
        // Quark format: [夸克网盘]：https://pan.quark.cn/s/xxx
        const url = this._extractURL(line);
        if (url && url.includes('pan.quark.cn')) {
          links.push({ type: 'quark', url, password: '' });
        }
      } else if (line.includes('[UC网盘]')) {
        // UC format: [UC网盘]：https://drive.uc.cn/s/xxx
        const url = this._extractURL(line);
        if (url && url.includes('drive.uc.cn')) {
          links.push({ type: 'uc', url, password: '' });
        }
      } else if (line.includes('pan.baidu.com')) {
        // Baidu format: https://pan.baidu.com/s/xxx?pwd=xxxx
        const { url, password } = this._extractBaiduLink(line);
        if (url) {
          links.push({ type: 'baidu', url, password });
        }
      }
    }

    return links;
  }

  /**
   * Extract URL from text
   */
  _extractURL(text) {
    const match = urlRegex.exec(text);
    return match ? match[0].trim() : '';
  }

  /**
   * Extract Baidu link and password
   */
  _extractBaiduLink(line) {
    const fullURL = this._extractURL(line);
    if (!fullURL) return { url: '', password: '' };

    const linkMatch = baiduLinkRegex.exec(fullURL);
    if (!linkMatch) return { url: '', password: '' };

    const url = linkMatch[0];
    let password = '';

    const pwdMatch = baiduPwdRegex.exec(fullURL);
    if (pwdMatch && pwdMatch.length >= 2) {
      password = pwdMatch[1];
    }

    return { url, password };
  }

  /**
   * Generate unique ID based on game name using MD5
   */
  _generateUniqueID(gameName) {
    const hash = crypto.createHash('md5').update(gameName).digest('hex');
    return `${this.name}-${hash}`.substring(0, 28);
  }
}

module.exports = NsgamePlugin;
