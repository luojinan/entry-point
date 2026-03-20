const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, convertDiskType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'kkmao';
const ARTICLE_ID_REGEX = /\/(\d+)\.html/;
const QUARK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/;
const PWD_PATTERNS = [
  /\u63D0\u53D6\u7801[:：]?\s*([0-9A-Za-z]+)/,
  /\u5BC6\u7801[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

class KkmaoPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 2);
  }

  async search(keyword, ext = {}) {
    const searchURL = `https://www.kuakemao.com/?s=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': 'https://www.kuakemao.com/',
      },
    }, { timeout: 12000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Collect items for concurrent detail fetching
    const items = [];

    $('article.excerpt').each((i, el) => {
      const s = $(el);
      const titleSel = s.find('header h2 a');
      const title = titleSel.text().trim();
      const detailURL = titleSel.attr('href');

      if (!title || !detailURL) return;

      const articleID = this.extractArticleID(detailURL);
      if (!articleID) return;

      const summary = s.find('p.note').text().trim();

      const tags = [];
      const category = s.find('.meta a.cat').first().text().trim();
      if (category) tags.push(category);

      const rawTime = s.find('.meta time').text().trim();
      const publishTime = this.parsePublishTime(rawTime);

      items.push({ title, detailURL, articleID, summary, tags, publishTime });
    });

    // Concurrently fetch detail links
    const tasks = items.map(async (item) => {
      try {
        const links = await this.fetchDetailLinks(item.detailURL, item.articleID);
        if (links.length === 0) return null;

        return {
          uniqueId: `${PLUGIN_NAME}-${item.articleID}`,
          title: item.title,
          content: item.summary,
          links,
          tags: item.tags,
          channel: '',
          datetime: item.publishTime,
        };
      } catch (e) {
        return null;
      }
    });

    const settled = await Promise.all(tasks);
    const results = settled.filter(Boolean);

    return filterByKeyword(results, keyword);
  }

  extractArticleID(detailURL) {
    const matches = ARTICLE_ID_REGEX.exec(detailURL);
    if (matches && matches.length >= 2) return matches[1];
    return '';
  }

  parsePublishTime(value) {
    if (!value || !value.trim()) return new Date().toISOString();

    const layouts = ['yyyy-MM-dd', 'yyyy-MM-dd HH:mm:ss'];

    // Try standard ISO parsing
    const parsed = new Date(value.trim());
    if (!isNaN(parsed.getTime())) return parsed.toISOString();

    return new Date().toISOString();
  }

  async fetchDetailLinks(detailURL, articleID) {
    try {
      const resp = await fetchWithRetry(detailURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Connection': 'keep-alive',
          'Referer': detailURL,
        },
      }, { timeout: 10000, retries: 1 });

      const html = await resp.text();
      const $ = cheerio.load(html);

      return this.extractQuarkLinks($);
    } catch (e) {
      return [];
    }
  }

  extractQuarkLinks($) {
    const results = [];
    const seen = new Set();

    $('.article-content a[href]').each((i, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;

      const loc = href.match(QUARK_REGEX);
      if (!loc) return;

      const normalizedURL = loc[0];
      if (seen.has(normalizedURL)) return;

      const password = this.extractPasswordFromLink($, $(el));

      results.push({
        type: 'quark',
        url: normalizedURL,
        password,
      });
      seen.add(normalizedURL);
    });

    return results;
  }

  extractPasswordFromLink($, link) {
    // Check link text
    let pwd = this.matchPassword(link.text());
    if (pwd) return pwd;

    // Check title attribute
    const title = link.attr('title');
    if (title) {
      pwd = this.matchPassword(title);
      if (pwd) return pwd;
    }

    // Check parent text
    const parent = link.parent();
    if (parent && parent.length > 0) {
      pwd = this.matchPassword(parent.text());
      if (pwd) return pwd;

      const next = parent.next();
      if (next.length > 0) {
        pwd = this.matchPassword(next.text());
        if (pwd) return pwd;
      }
    }

    // Check sibling
    const sibling = link.next();
    if (sibling.length > 0) {
      pwd = this.matchPassword(sibling.text());
      if (pwd) return pwd;
    }

    return '';
  }

  matchPassword(text) {
    if (!text || !text.trim()) return '';

    for (const pattern of PWD_PATTERNS) {
      const matches = pattern.exec(text);
      if (matches && matches.length >= 2) {
        return matches[1].trim();
      }
    }
    return '';
  }
}

module.exports = KkmaoPlugin;
