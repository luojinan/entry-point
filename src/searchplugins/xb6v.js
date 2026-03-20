const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, determineCloudType, extractPassword, fetchWithTimeout, fetchWithRetry, filterByKeyword, deduplicateResults } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'xb6v';
const BASE_URL = 'https://www.66ss.org';
const BACKUP_URL = 'https://www.xb6v.com';
const SEARCH_PATH = '/e/search/1index.php';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RESULTS = 50;

const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

class Xb6vPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
    this.currentBase = BASE_URL;
  }

  async search(keyword, ext = {}) {
    // Decode keyword if URL-encoded
    let decodedKeyword;
    try {
      decodedKeyword = decodeURIComponent(keyword);
    } catch (e) {
      decodedKeyword = keyword;
    }

    // Optimize keyword: if contains space, use only part before space
    const spaceIndex = decodedKeyword.indexOf(' ');
    if (spaceIndex > 0) {
      decodedKeyword = decodedKeyword.substring(0, spaceIndex);
    }

    keyword = decodedKeyword;

    // Step 1: POST search request
    const searchURL = this.currentBase + SEARCH_PATH;
    const postData = `show=title&tempid=1&tbname=article&mid=1&dopost=search&submit=&keyboard=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithTimeout(searchURL, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': this.currentBase,
      },
      body: postData,
      redirect: 'manual',
    }, 30000);

    // Get redirect location
    let location = resp.headers.get('location') || '';

    if (!location) {
      // Try to extract from response body
      const bodyStr = await resp.text();

      // JavaScript redirect
      let match = bodyStr.match(/location\.href\s*=\s*["']([^"']+)["']/);
      if (match) {
        location = match[1];
      }

      // URL pattern with searchid
      if (!location) {
        match = bodyStr.match(/(?:href|url)\s*[=:]\s*["']?([^"'\s]*searchid=[^"'\s&]+)/);
        if (match) {
          location = match[1];
        }
      }

      // Simple result/?searchid= format
      if (!location) {
        match = bodyStr.match(/result\/\?searchid=\d+/);
        if (match) {
          location = match[0];
        }
      }

      if (!location) {
        throw new Error('No search result redirect found');
      }
    }

    // Build full search result URL
    let resultURL;
    if (location.startsWith('result/')) {
      resultURL = this.currentBase + '/e/search/' + location;
    } else {
      resultURL = this.currentBase + '/' + location.replace(/^\//, '');
    }

    // Step 2: Get search results page
    const resp2 = await fetchWithRetry(resultURL, {
      headers: { ...HEADERS, 'Referer': this.currentBase },
    }, { timeout: 30000, retries: 2 });

    const html = await resp2.text();
    const $ = cheerio.load(html);

    // Extract detail page URLs and dates
    const detailPages = this.extractDetailURLs($);

    if (detailPages.length === 0) {
      return [];
    }

    const limitedPages = detailPages.slice(0, MAX_RESULTS);

    // Step 3: Concurrently fetch magnet links from detail pages
    const results = await this.fetchMagnetLinksFromDetails(limitedPages, keyword);

    // Filter valid results
    const validResults = results.filter(r => r.links.length > 0);

    // Keyword filter
    return filterByKeyword(validResults, keyword);
  }

  extractDetailURLs($) {
    const detailPages = [];
    const urlMap = new Set();

    $('ul#post_container li.post').each((i, el) => {
      const li = $(el);
      const linkEl = li.find("a[href*='.html']");
      if (linkEl.length === 0) return;

      const href = linkEl.attr('href');
      if (!href) return;

      // Check valid content URL format
      if (!this.isValidContentURL(href)) return;

      // Build full URL
      let fullURL;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        fullURL = href;
      } else {
        fullURL = this.currentBase + '/' + href.replace(/^\//, '');
      }

      if (urlMap.has(fullURL)) return;

      // Extract publish date
      const dateText = li.find('.info .info_date').text().trim();
      let publishDate = new Date().toISOString();
      if (dateText) {
        const parsed = new Date(dateText);
        if (!isNaN(parsed.getTime())) {
          publishDate = parsed.toISOString();
        }
      }

      urlMap.add(fullURL);
      detailPages.push({ url: fullURL, datetime: publishDate });
    });

    return detailPages;
  }

  isValidContentURL(href) {
    const parts = href.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return false;

    const lastPart = parts[parts.length - 1];
    if (!lastPart.endsWith('.html')) return false;

    const nameWithoutExt = lastPart.replace('.html', '');
    return /\d+/.test(nameWithoutExt);
  }

  async fetchMagnetLinksFromDetails(detailPages, keyword) {
    const tasks = detailPages.map(async (pageInfo, idx) => {
      try {
        // Stagger requests
        await new Promise(r => setTimeout(r, idx * 100));
        return await this.fetchDetailPageMagnetLinks(pageInfo.url, pageInfo.datetime);
      } catch (e) {
        return [];
      }
    });

    const results = await Promise.all(tasks);
    return results.flat();
  }

  async fetchDetailPageMagnetLinks(detailURL, publishDate) {
    const resp = await fetchWithRetry(detailURL, {
      headers: { ...HEADERS, 'Referer': this.currentBase },
    }, { timeout: 30000, retries: 1 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Extract page title
    let title = $('h1').text().trim() || '未知标题';
    title = this.cleanTitle(title);

    // Extract category
    const category = $('.info_category a').text().trim();

    // Extract magnet links
    const magnetLinksInfo = this.extractMagnetLinks($, title);

    if (magnetLinksInfo.length === 0) return [];

    // Generate SearchResult for each magnet link
    const results = [];
    for (let i = 0; i < magnetLinksInfo.length; i++) {
      const linkInfo = magnetLinksInfo[i];
      const resourceID = this.extractResourceID(detailURL) + '-' + i;
      const resultTitle = `${title}-${linkInfo.subTitle}`;

      results.push({
        uniqueId: `${PLUGIN_NAME}-${resourceID}`,
        title: resultTitle,
        content: `分类：${category}\n磁力链接：${linkInfo.subTitle}`,
        links: [{ type: 'magnet', url: linkInfo.url, password: '' }],
        datetime: publishDate,
        tags: category ? [category] : [],
        channel: '',
      });
    }

    return results;
  }

  extractMagnetLinks($, mainTitle) {
    const linkInfos = [];
    const linkMap = new Set();

    // Look for table cells containing "磁力："
    $('td').each((i, el) => {
      const s = $(el);
      const text = s.text();
      if (text.includes('磁力：')) {
        s.find("a[href^='magnet:']").each((j, a) => {
          const href = $(a).attr('href');
          if (!href || linkMap.has(href)) return;
          linkMap.add(href);

          let subTitle = $(a).text().trim() || '磁力链接';
          linkInfos.push({ url: href, subTitle });
        });
      }
    });

    // Fallback: search entire page
    if (linkInfos.length === 0) {
      $("a[href^='magnet:']").each((i, el) => {
        const href = $(el).attr('href');
        if (!href || linkMap.has(href)) return;
        linkMap.add(href);

        let subTitle = $(el).text().trim() || '磁力链接';
        linkInfos.push({ url: href, subTitle });
      });
    }

    return linkInfos;
  }

  extractResourceID(detailURL) {
    const match = detailURL.match(/\/(\d+)\.html/);
    return match ? match[1] : String(Date.now());
  }

  cleanTitle(title) {
    const cleaners = ['6v电影-新版', '6v电影', '新版6v', '新版6V', '6V电影'];
    let cleaned = title;
    for (const cleaner of cleaners) {
      // Remove prefix
      if (cleaned.startsWith(cleaner)) {
        cleaned = cleaned.substring(cleaner.length).replace(/^[\s\t\u3000]+/, '');
      }
      // Remove suffix
      if (cleaned.endsWith(cleaner)) {
        cleaned = cleaned.substring(0, cleaned.length - cleaner.length).replace(/[\s\t\u3000]+$/, '');
      }
      // Remove in middle
      if (cleaned.includes(cleaner)) {
        const parts = cleaned.split(cleaner).map(p => p.trim()).filter(Boolean);
        if (parts.length > 0) {
          cleaned = parts.join(' ');
        }
      }
    }
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    return cleaned || '未知标题';
  }
}

module.exports = Xb6vPlugin;
