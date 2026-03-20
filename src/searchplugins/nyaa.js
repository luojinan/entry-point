/**
 * nyaa - Nyaa BT search plugin
 * Searches nyaa.si for torrent magnet links
 */

const cheerio = require('cheerio');
const { BasePlugin, fetchWithRetry, filterByKeyword } = require('./base');

const SITE_URL = 'https://nyaa.si';

class Nyaa extends BasePlugin {
  constructor() {
    super('nyaa', 3);
  }

  async search(keyword, ext = {}) {
    // Support English keyword override
    let searchKeyword = keyword;
    if (ext && ext.title_en && typeof ext.title_en === 'string' && ext.title_en !== '') {
      searchKeyword = ext.title_en;
    }

    const searchURL = `${SITE_URL}/?f=0&c=0_0&q=${encodeURIComponent(searchKeyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Connection': 'keep-alive',
        'Referer': SITE_URL,
      },
    }, { timeout: 10000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    const results = [];
    const table = $('table.torrent-list tbody');
    if (table.length === 0) return [];

    table.find('tr').each((_, el) => {
      const s = $(el);

      // Extract category
      const categoryLink = s.find('td:nth-child(1) a');
      const category = categoryLink.attr('title') || '';

      // Extract title and detail link
      const titleLink = s.find('td[colspan="2"] a');
      if (titleLink.length === 0) return;

      let title = (titleLink.text() || '').trim();
      if (!title) title = titleLink.attr('title') || '';

      const detailHref = titleLink.attr('href');
      if (!detailHref) return;

      // Extract ID from detail link
      const idMatch = detailHref.match(/\/view\/(\d+)/);
      if (!idMatch) return;
      const itemID = idMatch[1];

      // Extract magnet link
      const magnetLink = s.find('td.text-center a[href^="magnet:"]');
      if (magnetLink.length === 0) return;
      const magnetURL = magnetLink.attr('href');
      if (!magnetURL) return;

      // Extract file size
      const sizeTd = s.find('td.text-center').eq(1);
      const size = (sizeTd.text() || '').trim();

      // Extract timestamp
      const dateTd = s.find('td.text-center[data-timestamp]');
      let datetime = new Date();
      if (dateTd.length > 0) {
        const ts = dateTd.attr('data-timestamp');
        if (ts) {
          const parsed = parseInt(ts, 10);
          if (!isNaN(parsed)) datetime = new Date(parsed * 1000);
        }
      }

      // Extract seeders/leechers/downloads
      const tds = s.find('td.text-center');
      let seeders = '0', leechers = '0', downloads = '0';
      if (tds.length >= 6) {
        seeders = (tds.eq(tds.length - 3).text() || '0').trim();
        leechers = (tds.eq(tds.length - 2).text() || '0').trim();
        downloads = (tds.eq(tds.length - 1).text() || '0').trim();
      }

      // Build content
      const contentParts = [];
      if (category) contentParts.push(`Category: ${category}`);
      if (size) contentParts.push(`Size: ${size}`);
      contentParts.push(`Seeders: ${seeders}`);
      contentParts.push(`Leechers: ${leechers}`);
      contentParts.push(`Completed: ${downloads}`);

      // Build tags
      const tags = [];
      if (category) tags.push(category);
      tags.push(`Seeders:${seeders}`);
      tags.push(`Leechers:${leechers}`);
      tags.push(`Completed:${downloads}`);

      results.push({
        uniqueId: `${this.name}-${itemID}`,
        title,
        content: contentParts.join(' | '),
        links: [{ type: 'magnet', url: magnetURL, password: '' }],
        datetime,
        tags,
        channel: '',
      });
    });

    return filterByKeyword(results, searchKeyword);
  }
}

module.exports = Nyaa;
