const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'wuji';
const BASE_URL = 'https://xcili.net';
const MAX_PAGES = 5;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

class WujiPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
  }

  async search(keyword, ext = {}) {
    // 1. Fetch all pages concurrently
    const pagePromises = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      pagePromises.push(this.searchPage(keyword, page).catch(() => []));
    }

    const pageResults = await Promise.all(pagePromises);
    let allResults = [];
    for (const results of pageResults) {
      allResults.push(...results);
    }

    // 2. Fetch magnet links from detail pages concurrently
    const finalResults = await this.enrichWithMagnetLinks(allResults);

    // 3. Filter by keyword
    const searchKeyword = (ext && ext.search) || keyword;
    return filterByKeyword(finalResults, searchKeyword);
  }

  async searchPage(keyword, page) {
    const searchURL = `${BASE_URL}/search?q=${encodeURIComponent(keyword)}&page=${page}`;

    const resp = await fetchWithRetry(searchURL, { headers: HEADERS }, { timeout: 30000, retries: 3 });
    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.extractSearchResults($);
  }

  extractSearchResults($) {
    const results = [];

    $('table.file-list tbody tr').each((i, el) => {
      const s = $(el);
      const result = this.parseSearchResult($, s);
      if (result && result.title) {
        results.push(result);
      }
    });

    return results;
  }

  parseSearchResult($, s) {
    // Extract title and detail page link
    const titleCell = s.find('td').first();
    const titleLink = titleCell.find('a');

    const detailPath = titleLink.attr('href');
    if (!detailPath) return null;

    const detailURL = BASE_URL + detailPath;

    // Extract title (excluding p.sample content)
    const titleClone = titleLink.clone();
    titleClone.find('p.sample').remove();
    let title = titleClone.text().trim();
    title = this.cleanTitle(title);

    // Extract file name preview
    const sampleText = titleLink.find('p.sample').text().trim();

    // Extract file size
    const sizeText = s.find('td.td-size').text().trim();

    // Build content
    const contentParts = [];
    if (sampleText) contentParts.push('文件: ' + sampleText);
    if (sizeText) contentParts.push('大小: ' + sizeText);
    const content = contentParts.join('\n');

    return {
      uniqueId: generateUniqueID(PLUGIN_NAME, detailURL, String(Date.now())),
      title,
      content,
      links: [{ type: 'detail', url: detailURL, password: '' }],
      datetime: new Date().toISOString(),
      tags: ['magnet'],
      channel: '',
      _detailURL: detailURL,
    };
  }

  cleanTitle(title) {
    // Remove ad content in brackets
    title = title.replace(/【[^】]*】/g, '');
    title = title.replace(/^\d+【[^】]*】/g, '');
    title = title.replace(/\[[^\]]*\]/g, '');
    title = title.replace(/\s+/g, ' ');
    return title.trim();
  }

  async enrichWithMagnetLinks(results) {
    if (results.length === 0) return results;

    const tasks = results.map(async (result, index) => {
      if (!result._detailURL) return null;

      try {
        // Small delay to avoid overwhelming the server
        await new Promise(r => setTimeout(r, (index % 5) * 100));

        const magnetLink = await this.fetchMagnetLink(result._detailURL);
        if (magnetLink) {
          const { _detailURL, ...cleanResult } = result;
          cleanResult.links = [{ type: 'magnet', url: magnetLink, password: '' }];
          return cleanResult;
        }
      } catch (e) {
        // skip
      }
      return null;
    });

    const settled = await Promise.all(tasks);
    return settled.filter(Boolean);
  }

  async fetchMagnetLink(detailURL) {
    const resp = await fetchWithRetry(detailURL, { headers: HEADERS }, { timeout: 30000, retries: 3 });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract magnet link from input#input-magnet
    const magnetInput = $('input#input-magnet');
    if (magnetInput.length === 0) return null;

    const magnetLink = magnetInput.attr('value');
    return magnetLink || null;
  }
}

module.exports = WujiPlugin;
