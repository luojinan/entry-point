const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'xuexizhinan';
const SEARCH_URL = 'https://xuexizhinan.com/?post_type=book&s=%s';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36';

// Pre-compiled regex patterns
const DETAIL_URL_REGEX = /https:\/\/xuexizhinan\.com\/book\/(\d+)\.html/;
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-zA-Z]+/g;
const DATE_REGEX = /上映日期: (\d{4}-\d{2}-\d{2})/;

class XuexizhinanPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 1);
  }

  async search(keyword, ext = {}) {
    const searchURL = SEARCH_URL.replace('%s', encodeURIComponent(keyword));

    const resp = await fetchWithRetry(searchURL, {
      headers: { 'User-Agent': USER_AGENT },
    }, { timeout: 10000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract search results with keyword filtering
    const lowerKeyword = keyword.toLowerCase();
    const keywords = lowerKeyword.split(/\s+/).filter(Boolean);

    const validItems = [];

    $('.url-card').each((i, el) => {
      const s = $(el);
      const titleElem = s.find('.list-title');
      const title = titleElem.text().trim();
      const link = titleElem.attr('href') || '';

      if (!link || !title) return;

      // Check if title contains all keywords
      const lowerTitle = title.toLowerCase();
      const matched = keywords.every(kw => lowerTitle.includes(kw));

      if (matched) {
        validItems.push({ url: link, title });
      }
    });

    if (validItems.length === 0) return [];

    // Concurrently fetch detail pages
    const tasks = validItems.map(item =>
      this.processDetailPage(item.url).catch(() => null)
    );

    const rawResults = await Promise.all(tasks);
    const results = rawResults.filter(Boolean);

    // Keyword filter
    return filterByKeyword(results, keyword);
  }

  async processDetailPage(detailURL) {
    // Validate URL format
    const idMatch = detailURL.match(DETAIL_URL_REGEX);
    if (!idMatch) return null;

    const resp = await fetchWithRetry(detailURL, {
      headers: { 'User-Agent': USER_AGENT },
    }, { timeout: 10000, retries: 1 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 1. Extract title
    let title = $('.book-header h1').text().trim();
    if (!title) {
      title = $('title').text().replace(/ \| 4K指南$/, '').trim();
    }

    // 2. Extract cover image
    const imageURL = $('.book-cover img').attr('src') || '';

    // 3. Extract tags
    const tags = [];
    $('.book-header .my-2 a').each((i, el) => {
      const tag = $(el).text().trim();
      if (tag) tags.push(tag);
    });

    // 4. Extract content
    const content = $('.panel-body.single').text().trim();

    // 5. Extract magnet links and quark links
    const magnetLinks = [];
    const quarkLinks = [];

    $('li, .site-go a').each((i, el) => {
      const s = $(el);

      if (s.is('li')) {
        // Extract magnet links
        const text = s.text();
        if (text.includes('magnet:?xt=urn:btih:')) {
          MAGNET_LINK_REGEX.lastIndex = 0;
          const magnetMatch = text.match(MAGNET_LINK_REGEX);
          if (magnetMatch) {
            for (const m of magnetMatch) {
              magnetLinks.push(m);
            }
          }
        }
      } else if (s.is('a')) {
        // Extract quark links
        const href = s.attr('href') || '';
        const attrTitle = s.attr('title') || '';
        const name = s.find('.b-name').text();

        if (href.includes('pan.quark.cn') || name.includes('夸克') || attrTitle.includes('夸克')) {
          quarkLinks.push({
            type: 'quark',
            url: href,
            password: '',
          });
        }
      }
    });

    // Check if we have any useful data
    if (!title && magnetLinks.length === 0 && quarkLinks.length === 0) {
      return null;
    }

    // Extract ID
    const id = idMatch[1];
    const uniqueId = `${PLUGIN_NAME}-${id}`;

    // Extract date from content
    let datetime = '';
    const dateMatch = content.match(DATE_REGEX);
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        datetime = parsed.toISOString();
      }
    }

    // Build links array
    const links = [];
    for (const magnetLink of magnetLinks) {
      links.push({ type: 'magnet', url: magnetLink, password: '' });
    }
    links.push(...quarkLinks);

    return {
      uniqueId,
      title,
      content,
      links,
      datetime,
      tags,
      channel: '',
    };
  }
}

module.exports = XuexizhinanPlugin;
