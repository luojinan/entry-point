/**
 * gying - 共影搜索插件
 * 影视资源搜索，需要登录cookie。从搜索页提取 _obj.search JSON 数据，
 * 然后并发请求详情 API 获取网盘链接。
 *
 * NOTE: This plugin requires authenticated sessions (cloudscraper with cookies).
 * The Node.js version implements a simplified version that uses direct HTTP requests
 * with cookie support. Users need to configure cookies externally.
 */

const { BasePlugin, fetchWithRetry, filterByKeyword } = require('./base');

const SEARCH_URL_TEMPLATE = 'https://www.gying.net/s/2-0--1/%s';
const DETAIL_URL_TEMPLATE = 'https://www.gying.net/res/downurl/%s/%s';
const REFRESH_URL = 'https://www.gying.net/mv/wkMn';
const MAX_CONCURRENT = 50;

// Regex to extract _obj.search JSON
const SEARCH_DATA_REGEX = /_obj\.search=(\{.*?\});/;

class Gying extends BasePlugin {
  constructor() {
    super('gying', 3);
    this._cookie = '';
  }

  /**
   * Set cookie for authenticated requests.
   * @param {string} cookie - Cookie string for gying.net
   */
  setCookie(cookie) {
    this._cookie = cookie;
  }

  async search(keyword, ext = {}) {
    // Use cookie from ext if provided
    const cookie = ext.cookie || this._cookie || '';

    // 1. Request search page
    const searchURL = SEARCH_URL_TEMPLATE.replace('%s', encodeURIComponent(keyword));

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Referer': 'https://www.gying.net/',
    };

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers,
    }, { timeout: 30000, retries: 2 });

    if (resp.status === 403) {
      throw new Error('HTTP 403 Forbidden - cookie may have expired');
    }

    const body = await resp.text();

    // 2. Extract _obj.search JSON
    const match = body.match(SEARCH_DATA_REGEX);
    if (!match || !match[1]) {
      throw new Error('Search data not found in page');
    }

    let searchData;
    try {
      searchData = JSON.parse(match[1]);
    } catch (e) {
      throw new Error(`Failed to parse search data: ${e.message}`);
    }

    if (!searchData.l || !searchData.l.i || searchData.l.i.length === 0) {
      return [];
    }

    // 3. Refresh anti-crawl cookies (visit a detail page)
    try {
      await fetchWithRetry(REFRESH_URL, {
        method: 'GET',
        headers,
      }, { timeout: 10000, retries: 1 });
    } catch (e) {
      // Ignore refresh errors
    }

    // 4. Fetch details concurrently
    const results = await this._fetchAllDetails(searchData, headers, keyword);

    return results;
  }

  async _fetchAllDetails(searchData, headers, keyword) {
    const results = [];
    const keywordLower = keyword.toLowerCase();
    const indices = [];

    // Filter by title keyword first
    for (let i = 0; i < searchData.l.i.length; i++) {
      if (i >= (searchData.l.title || []).length) continue;
      const title = searchData.l.title[i];
      if (title && title.toLowerCase().includes(keywordLower)) {
        indices.push(i);
      }
    }

    // Fetch details in batches
    for (let i = 0; i < indices.length; i += MAX_CONCURRENT) {
      const batch = indices.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (index) => {
          const resourceID = searchData.l.i[index];
          const resourceType = searchData.l.d[index];

          const detail = await this._fetchDetail(resourceID, resourceType, headers);
          if (!detail) return null;

          return this._buildResult(detail, searchData, index);
        })
      );

      for (const res of batchResults) {
        if (res.status === 'fulfilled' && res.value && res.value.title && res.value.links.length > 0) {
          results.push(res.value);
        }
      }
    }

    // Deduplicate
    return this._deduplicateResults(results);
  }

  async _fetchDetail(resourceID, resourceType, headers) {
    try {
      const detailURL = DETAIL_URL_TEMPLATE
        .replace('%s', resourceType)
        .replace('%s', resourceID);

      const resp = await fetchWithRetry(detailURL, {
        method: 'GET',
        headers,
      }, { timeout: 15000, retries: 1 });

      if (resp.status === 403) return null;
      if (resp.status !== 200) return null;

      const data = await resp.json();

      // Check code field
      if (data.code === 403) return null;

      return data;
    } catch (err) {
      return null;
    }
  }

  _buildResult(detail, searchData, index) {
    if (index >= (searchData.l.title || []).length) return null;

    let title = searchData.l.title[index];
    const resourceType = searchData.l.d[index];
    const resourceID = searchData.l.i[index];

    // Add year to title
    let year = 0;
    if (index < (searchData.l.year || []).length && searchData.l.year[index] > 0) {
      year = searchData.l.year[index];
      title = `${title}（${year}）`;
    }

    // Build content
    const contentParts = [];
    if (index < (searchData.l.info || []).length && searchData.l.info[index]) {
      contentParts.push(searchData.l.info[index]);
    }
    if (index < (searchData.l.daoyan || []).length && searchData.l.daoyan[index]) {
      contentParts.push(`导演: ${searchData.l.daoyan[index]}`);
    }
    if (index < (searchData.l.zhuyan || []).length && searchData.l.zhuyan[index]) {
      contentParts.push(`主演: ${searchData.l.zhuyan[index]}`);
    }

    // Extract pan links
    const links = this._extractPanLinks(detail);

    // Build tags
    const tags = [];
    if (year > 0) tags.push(`${year}`);

    // Parse update time
    const datetime = this._parseUpdateTime(detail.panlist ? detail.panlist.time : []);

    return {
      uniqueId: `gying-${resourceType}-${resourceID}`,
      title,
      content: contentParts.join(' | '),
      links,
      tags,
      channel: '',
      datetime,
    };
  }

  _extractPanLinks(detail) {
    const links = [];
    const seen = new Set();

    if (!detail || !detail.panlist || !detail.panlist.url) return links;

    const accessCodeRegex = /（访问码：.*?）/g;
    const accessCodeRegex2 = /\(访问码：.*?\)/g;

    for (let i = 0; i < detail.panlist.url.length; i++) {
      let linkURL = (detail.panlist.url[i] || '').trim();

      // Remove access code markers from URL
      linkURL = linkURL.replace(accessCodeRegex, '').replace(accessCodeRegex2, '').trim();

      if (!linkURL || seen.has(linkURL)) continue;
      seen.add(linkURL);

      // Determine link type
      const linkType = this._determineLinkType(linkURL);
      if (linkType === 'others') continue;

      // Extract password
      let password = '';
      if (i < (detail.panlist.p || []).length && detail.panlist.p[i]) {
        password = detail.panlist.p[i];
      }

      // Extract password from URL (takes priority)
      const urlPwd = this._extractPasswordFromURL(linkURL);
      if (urlPwd) password = urlPwd;

      // Parse corresponding time
      let linkDatetime = '';
      if (i < (detail.panlist.time || []).length && detail.panlist.time[i]) {
        linkDatetime = this._parseRelativeTimeStr(detail.panlist.time[i]);
      }

      links.push({
        type: linkType,
        url: linkURL,
        password,
      });
    }

    return links;
  }

  _determineLinkType(url) {
    if (url.includes('pan.quark.cn')) return 'quark';
    if (url.includes('drive.uc.cn')) return 'uc';
    if (url.includes('pan.baidu.com')) return 'baidu';
    if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
    if (url.includes('pan.xunlei.com')) return 'xunlei';
    if (url.includes('cloud.189.cn')) return 'tianyi';
    if (url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) return '115';
    if (url.includes('123684.com') || url.includes('123685.com') || url.includes('123912.com') || url.includes('123pan.com') || url.includes('123pan.cn') || url.includes('123592.com')) return '123';
    return 'others';
  }

  _extractPasswordFromURL(url) {
    const pwdMatch = url.match(/\?pwd=([a-zA-Z0-9]+)/);
    if (pwdMatch) return pwdMatch[1];

    const passwordMatch = url.match(/\?password=([a-zA-Z0-9]+)/);
    if (passwordMatch) return passwordMatch[1];

    return '';
  }

  _parseUpdateTime(timeStrs) {
    if (!timeStrs || timeStrs.length === 0) return new Date().toISOString();

    const now = new Date();
    let latestTime = null;

    for (const timeStr of timeStrs) {
      if (!timeStr) continue;
      const parsed = this._parseRelativeTime(timeStr, now);
      if (parsed && (!latestTime || parsed > latestTime)) {
        latestTime = parsed;
      }
    }

    return latestTime ? latestTime.toISOString() : new Date().toISOString();
  }

  _parseRelativeTimeStr(timeStr) {
    const parsed = this._parseRelativeTime(timeStr, new Date());
    return parsed ? parsed.toISOString() : '';
  }

  _parseRelativeTime(timeStr, baseTime) {
    if (!timeStr) return null;
    timeStr = timeStr.trim();

    if (timeStr === '今天') {
      const d = new Date(baseTime);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (timeStr === '昨天') {
      const d = new Date(baseTime);
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      return d;
    }

    // Parse "N天前", "N月前", "N年前"
    let match = timeStr.match(/^(\d+)天前$/);
    if (match) {
      const d = new Date(baseTime);
      d.setDate(d.getDate() - parseInt(match[1], 10));
      d.setHours(0, 0, 0, 0);
      return d;
    }

    match = timeStr.match(/^(\d+)月前$/);
    if (match) {
      const d = new Date(baseTime);
      d.setMonth(d.getMonth() - parseInt(match[1], 10));
      d.setHours(0, 0, 0, 0);
      return d;
    }

    match = timeStr.match(/^(\d+)年前$/);
    if (match) {
      const d = new Date(baseTime);
      d.setFullYear(d.getFullYear() - parseInt(match[1], 10));
      d.setHours(0, 0, 0, 0);
      return d;
    }

    return null;
  }

  _deduplicateResults(results) {
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.uniqueId)) return false;
      seen.add(r.uniqueId);
      return true;
    });
  }
}

module.exports = Gying;
