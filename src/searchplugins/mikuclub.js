const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const CATEGORY_IDS = ['9305', '942'];

// Link patterns with regex and type
const linkPatterns = [
  { reg: /https?:\/\/pan\.quark\.cn\/(s|g)\/[0-9A-Za-z]+/, typ: 'quark' },
  { reg: /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/, typ: 'aliyun' },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_]+/, typ: 'baidu' },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_]+/, typ: 'xunlei' },
  { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, typ: 'uc' },
  { reg: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/, typ: 'pikpak' },
  { reg: /https?:\/\/caiyun\.139\.com\/[^\s]+/, typ: 'mobile' },
  { reg: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, typ: 'magnet' },
  { reg: /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/, typ: '123' },
];

const textURLRegex = /https?:\/\/[^\s<>"']+/g;

const passwordPatterns = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const MAX_CONCURRENCY = 12;

class MikuclubPlugin extends BasePlugin {
  constructor() {
    super('mikuclub', 2);
  }

  /**
   * Search for resources
   * @param {string} keyword
   * @param {object} ext
   * @returns {Promise<Array>}
   */
  async search(keyword, ext = {}) {
    // Fetch posts from both categories concurrently
    const categoryPromises = CATEGORY_IDS.map(catID =>
      this._fetchCategoryPosts(keyword, catID).catch(() => [])
    );

    const categoryResults = await Promise.all(categoryPromises);

    // Deduplicate posts by ID
    const seenPosts = new Map();
    const allPosts = [];
    for (const posts of categoryResults) {
      for (const post of posts) {
        if (!seenPosts.has(post.id)) {
          seenPosts.set(post.id, true);
          allPosts.push(post);
        }
      }
    }

    if (allPosts.length === 0) return [];

    // Fetch detail pages concurrently with limited concurrency
    const results = [];
    const semaphore = { count: 0, max: MAX_CONCURRENCY };

    const tasks = allPosts.map(async (post) => {
      while (semaphore.count >= semaphore.max) {
        await new Promise(r => setTimeout(r, 50));
      }
      semaphore.count++;

      try {
        const links = await this._fetchDetailLinks(post.post_href);
        if (links.length === 0) return;

        // Build summary
        let content = '';
        if (post.post_rank_description) {
          content += `口碑：${post.post_rank_description.trim()} `;
        }
        if (post.post_views > 0) {
          content += `浏览：${post.post_views} `;
        }
        content = content.trim();

        // Build tags
        const tags = [];
        if (post.post_main_cat_name) tags.push(post.post_main_cat_name);
        if (post.post_cat_name) tags.push(post.post_cat_name);

        // Parse datetime
        let datetime = '';
        if (post.post_date) {
          try {
            const d = new Date(post.post_date);
            if (!isNaN(d.getTime())) datetime = d.toISOString();
          } catch (e) { /* ignore */ }
        }

        results.push({
          uniqueId: `${this.name}-${post.id}`,
          title: (post.post_title || '').trim(),
          content,
          links,
          datetime,
          tags,
          channel: '',
        });
      } catch (e) {
        // ignore errors
      } finally {
        semaphore.count--;
      }
    });

    await Promise.all(tasks);

    return filterByKeyword(results, keyword);
  }

  /**
   * Fetch posts from a category via WordPress REST API
   */
  async _fetchCategoryPosts(keyword, catID) {
    const params = new URLSearchParams({
      search: keyword,
      s: keyword,
      page: '',
      pagename: 'search_page',
      page_type: 'search',
      paged: '1',
      custom_orderby: 'relevance',
      no_cache: '1',
      custom_cat: catID,
    });

    const reqURL = `https://www.mikuclub.uk/wp-json/utils/v2/post_list?${params.toString()}`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Referer': 'https://www.mikuclub.uk/',
    };

    const resp = await fetchWithRetry(reqURL, { headers }, { timeout: 12000, retries: 2 });
    const data = await resp.json();

    return data.posts || [];
  }

  /**
   * Fetch detail page and extract links
   */
  async _fetchDetailLinks(detailURL) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Referer': detailURL,
    };

    const resp = await fetchWithRetry(detailURL, { headers }, { timeout: 10000, retries: 1 });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Find content container
    let container = $('.article_content');
    if (container.length === 0) container = $('article.post, .entry-content');
    if (container.length === 0) container = $.root();

    return this._extractLinksFromSelection($, container);
  }

  /**
   * Extract links from HTML selection (both href and text)
   */
  _extractLinksFromSelection($, sel) {
    const results = [];
    const seen = new Set();

    // From <a> href attributes
    sel.find('a[href]').each((_, node) => {
      const href = $(node).attr('href');
      if (!href) return;
      const trimmed = href.trim();
      if (!trimmed) return;

      const { type, normalized } = this._classifyLink(trimmed);
      if (!type) return;
      if (seen.has(normalized)) return;

      const password = this._extractPasswordFromNode($, $(node));
      results.push({ type, url: normalized, password });
      seen.add(normalized);
    });

    // From text content
    const text = sel.text();
    textURLRegex.lastIndex = 0;
    let match;
    while ((match = textURLRegex.exec(text)) !== null) {
      const raw = match[0];
      const { type, normalized } = this._classifyLink(raw);
      if (!type) continue;
      if (seen.has(normalized)) continue;

      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + match[0].length + 80);
      const context = text.substring(start, end);
      const password = this._matchPassword(context);

      results.push({ type, url: normalized, password });
      seen.add(normalized);
    }

    return results;
  }

  _classifyLink(raw) {
    for (const pattern of linkPatterns) {
      const match = pattern.reg.exec(raw);
      if (match) {
        return { type: pattern.typ, normalized: match[0] };
      }
    }
    return { type: '', normalized: '' };
  }

  _extractPasswordFromNode($, node) {
    const candidates = [node.text()];

    const title = node.attr('title');
    if (title) candidates.push(title);

    const parent = node.parent();
    if (parent && parent.length > 0) {
      candidates.push(parent.text());
      const next = parent.next();
      if (next.length > 0) candidates.push(next.text());
    }

    const sibling = node.next();
    if (sibling.length > 0) candidates.push(sibling.text());

    for (const text of candidates) {
      const pwd = this._matchPassword(text);
      if (pwd) return pwd;
    }
    return '';
  }

  _matchPassword(text) {
    text = (text || '').trim();
    if (!text) return '';
    for (const pattern of passwordPatterns) {
      const match = pattern.exec(text);
      if (match && match.length >= 2) return match[1].trim();
    }
    return '';
  }
}

module.exports = MikuclubPlugin;
