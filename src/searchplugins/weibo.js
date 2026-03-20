const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');

const PLUGIN_NAME = 'weibo';
const MAX_PAGES = 3;

// Network drive link patterns
const DRIVE_PATTERNS = {
  baidu:  /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]+)?/g,
  quark:  /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:\?pwd=[a-zA-Z0-9]+)?/g,
  aliyun: /https?:\/\/www\.alip?a?n\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?|https?:\/\/www\.aliyundrive\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/g,
  '115':  /https?:\/\/115\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/g,
  tianyi: /https?:\/\/cloud\.189\.cn\/(?:t\/|web\/share\?code=)[a-zA-Z0-9]+(?:&?[^\s]*)?/g,
  xunlei: /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/g,
  '123':  /https?:\/\/www\.123pan\.com\/s\/[a-zA-Z0-9_-]+(?:\?[^\s]*)?/g,
  pikpak: /https?:\/\/mypikpak\.com\/s\/[a-zA-Z0-9]+(?:\?[^\s]*)?/g,
};

const PWD_PATTERNS = [
  /(?:密码|提取码|访问码|pwd|code)[：:\s]*([a-zA-Z0-9]{4})/,
  /pwd=([a-zA-Z0-9]{4})/,
];

const SINAURL_PATTERN = /https:\/\/weibo\.cn\/sinaurl\?u=([^"&\s]+)/g;

class WeiboPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  /**
   * Search requires cookie and userIDs to be passed via ext.
   * ext.cookie - Weibo login cookie string
   * ext.userIDs - Array of Weibo user IDs to search
   *
   * In practice this plugin needs authenticated cookies from QR login,
   * so it will typically return empty results unless properly configured.
   */
  async search(keyword, ext = {}) {
    const cookie = ext.cookie || '';
    const userIDs = ext.userIDs || [];

    if (!cookie || userIDs.length === 0) {
      return [];
    }

    const allResults = [];

    // Search each user's weibo concurrently
    const tasks = userIDs.slice(0, 10).map(uid =>
      this.searchUserWeibo(uid, cookie, keyword).catch(() => [])
    );

    const taskResults = await Promise.all(tasks);
    for (const results of taskResults) {
      allResults.push(...results);
    }

    return allResults;
  }

  async searchUserWeibo(uid, cookie, keyword) {
    const results = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const apiURL = new URL('https://weibo.com/ajax/profile/searchblog');
        apiURL.searchParams.set('uid', uid);
        apiURL.searchParams.set('feature', '0');
        apiURL.searchParams.set('q', keyword);
        apiURL.searchParams.set('page', String(page));

        const resp = await fetchWithTimeout(apiURL.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://weibo.com/',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Cookie': cookie,
          },
        }, 30000);

        if (!resp.ok) break;

        const apiResp = await resp.json();

        const okValue = apiResp.ok;
        const isOK = okValue === 1 || okValue === true || String(okValue) === '1';
        if (!isOK) break;

        const data = apiResp.data;
        if (!data) break;

        const list = data.list || [];
        if (list.length === 0) break;

        for (const weibo of list) {
          const result = this.parseWeibo(weibo, uid);
          if (result.links.length > 0) {
            results.push(result);
          }
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        break;
      }
    }

    return results;
  }

  parseWeibo(weibo, uid) {
    // Prefer text_raw, fallback to text
    let textRaw = weibo.text_raw || weibo.text || '';
    const text = this.cleanHTMLText(textRaw);

    // Parse publish time
    const createdAt = weibo.created_at || '';
    let datetime = new Date().toISOString();
    if (createdAt) {
      const parsed = new Date(createdAt);
      if (!isNaN(parsed.getTime())) {
        datetime = parsed.toISOString();
      }
    }

    // Extract drive links from text
    let links = this.extractNetworkDriveLinks(text);

    // Process url_struct field (contains decoded external links)
    const urlStruct = weibo.url_struct || [];
    if (Array.isArray(urlStruct)) {
      for (const urlItem of urlStruct) {
        if (urlItem.url_title !== '网页链接') continue;
        const longURL = urlItem.long_url || '';
        if (!longURL) continue;

        const directLinks = this.extractNetworkDriveLinks(longURL);
        links.push(...directLinks);
      }
    }

    // Build title
    let title = text;
    if (text.length > 100) {
      title = text.substring(0, 100) + '...';
    }

    // Get weibo ID
    let id = '';
    if (typeof weibo.idstr === 'string') {
      id = weibo.idstr;
    } else if (typeof weibo.id === 'number') {
      id = String(Math.floor(weibo.id));
    } else {
      id = String(weibo.id || Date.now());
    }

    return {
      uniqueId: `weibo-${uid}-${id}`,
      title,
      content: text,
      links,
      datetime,
      tags: [],
      channel: '',
    };
  }

  extractNetworkDriveLinks(text) {
    const links = [];
    const seenURLs = new Set();

    for (const [linkType, pattern] of Object.entries(DRIVE_PATTERNS)) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const url = match[0];
        if (seenURLs.has(url)) continue;
        seenURLs.add(url);

        // Try to extract password from surrounding context
        let password = '';
        const start = text.indexOf(url);
        if (start !== -1) {
          const contextStart = Math.max(0, start - 50);
          const contextEnd = Math.min(text.length, start + url.length + 50);
          const context = text.substring(contextStart, contextEnd);

          for (const pwdPattern of PWD_PATTERNS) {
            const pwdMatch = context.match(pwdPattern);
            if (pwdMatch) {
              password = pwdMatch[1];
              break;
            }
          }
        }

        links.push({ type: linkType, url, password });
      }
    }

    return links;
  }

  cleanHTMLText(html) {
    if (!html) return '';
    let text = html.replace(/<[^>]+>/g, '');
    text = text.trim();
    text = text.replace(/\s+/g, ' ');
    return text;
  }
}

module.exports = WeiboPlugin;
