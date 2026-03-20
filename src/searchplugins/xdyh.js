const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');

const PLUGIN_NAME = 'xdyh';
const API_URL = 'https://ys.66ds.de/search';
const REFERER_URL = 'https://ys.66ds.de/';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Content-Type': 'application/json',
  'Referer': REFERER_URL,
  'Origin': 'https://ys.66ds.de',
  'Cache-Control': 'max-age=0',
};

// Tag keywords for extraction from titles
const TAG_KEYWORDS = {
  '4k': '4K',
  '1080p': '1080P',
  '720p': '720P',
  '蓝光': '蓝光',
  '高清': '高清',
  '更新': '更新中',
  '完结': '完结',
  '电影': '电影',
  '剧集': '剧集',
  '动漫': '动漫',
  '综艺': '综艺',
};

class XdyhPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    // Build request body
    const requestBody = {
      keyword,
      sites: null,
      max_workers: 10,
      save_to_file: false,
      split_links: true,
    };

    const resp = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(requestBody),
    }, { timeout: 15000, retries: 3 });

    const apiResp = await resp.json();

    // Check API response status
    if (apiResp.status !== 'success') {
      throw new Error(`API returned error status: ${apiResp.status}`);
    }

    // Convert to standard format
    const results = this.convertToSearchResults(apiResp, keyword);

    // Keyword filter
    return filterByKeyword(results, keyword);
  }

  convertToSearchResults(apiResp, keyword) {
    const results = [];
    const seenTitles = new Set();
    const data = apiResp.data || [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i];

      // Deduplicate by title + source
      const titleKey = `${item.title}_${item.source_site}`;
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      // Convert drive links
      const links = this.convertDriveLinks(item);
      if (links.length === 0) continue;

      // Parse datetime
      const datetime = this.parseDateTime(item.post_date);

      // Build content
      const content = this.buildContentDescription(item);

      // Extract tags
      const tags = this.extractTags(item.title, item.source_site);

      results.push({
        uniqueId: `${PLUGIN_NAME}-${i}`,
        title: item.title || '',
        content,
        links,
        datetime,
        tags,
        channel: '',
      });
    }

    return results;
  }

  convertDriveLinks(item) {
    const links = [];
    const driveLinks = item.drive_links || [];

    for (const driveURL of driveLinks) {
      if (!driveURL || !this.isValidURL(driveURL)) continue;

      const linkType = determineCloudType(driveURL);

      links.push({
        type: linkType,
        url: driveURL,
        password: item.password || '',
      });
    }

    return links;
  }

  parseDateTime(dateStr) {
    if (!dateStr) return new Date().toISOString();

    const formats = [
      // ISO-like formats are handled natively by Date constructor
    ];

    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return new Date().toISOString();
  }

  buildContentDescription(item) {
    const parts = [];

    if (item.source_site) parts.push(`来源: ${item.source_site}`);
    if (item.link_count > 0) parts.push(`链接数: ${item.link_count}`);
    if (item.has_password && item.password) parts.push(`密码: ${item.password}`);

    if (item.file_preview) {
      let preview = item.file_preview.replace(/<em>/g, '').replace(/<\/em>/g, '');
      if (preview.length > 100) preview = preview.substring(0, 100) + '...';
      parts.push(`预览: ${preview}`);
    }

    return parts.join(' | ');
  }

  extractTags(title, sourceSite) {
    const tags = [];

    if (sourceSite) tags.push(sourceSite);

    const lowerTitle = (title || '').toLowerCase();
    for (const [keyword, tag] of Object.entries(TAG_KEYWORDS)) {
      if (lowerTitle.includes(keyword)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  isValidURL(urlStr) {
    if (!urlStr) return false;
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      if (urlStr.length <= 8 || urlStr === 'http://' || urlStr === 'https://') return false;
      return urlStr.substring(8).includes('.');
    }
    return false;
  }
}

module.exports = XdyhPlugin;
