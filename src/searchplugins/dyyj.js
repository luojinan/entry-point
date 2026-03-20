/**
 * dyyj - 电影云集插件
 * 影视资源网盘链接搜索，基于Flarum论坛，搜索结果在noscript标签中
 * 需要获取详情页提取网盘链接和发布时间
 */

const cheerio = require('cheerio');
const { BasePlugin, fetchWithRetry, filterByKeyword, determineCloudType } = require('./base');

const BASE_URL = 'https://bbs.dyyjmax.org';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_RESULTS = 100;
const MAX_CONCURRENT = 100;

// Pre-compiled regex patterns
const POST_ID_REGEX = /\/d\/(\d+)/;
const NOSCRIPT_REGEX = /<noscript[^>]*id=["']flarum-content["'][^>]*>([\s\S]*?)<\/noscript>/;
const LI_LINK_REGEX = /<li[^>]*>\s*<a[^>]*href=["']([^"']*\/d\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/g;
const HTML_TAG_REGEX = /<[^>]+>/g;

// Publish time extraction patterns
const PUBLISH_TIME_REGEXES = [
  /<meta\s+name=["']article:published_time["']\s+content=["']([^"']+)["']/,
  /<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/,
  /<meta\s+name=["']article:updated_time["']\s+content=["']([^"']+)["']/,
  /<time[^>]*datetime=["']([^"']+)["']/,
];

// Network disk link patterns
const NETWORK_DISK_PATTERNS = [
  { name: '夸克网盘', regex: /<p><strong>夸克[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'quark' },
  { name: '百度网盘', regex: /<p><strong>百度[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'baidu' },
  { name: '阿里云盘', regex: /<p><strong>阿里[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'aliyun' },
  { name: '天翼云盘', regex: /<p><strong>天翼[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'tianyi' },
  { name: '迅雷网盘', regex: /<p><strong>迅雷[^<]*<\/strong><\/p>\s*<p><a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/g, urlType: 'xunlei' },
  { name: '通用网盘', regex: /<a[^>]*href\s*=\s*["'](https?:\/\/[^"']*(?:pan|drive|cloud)[^"']*)["'][^>]*>/g, urlType: 'others' },
];

class Dyyj extends BasePlugin {
  constructor() {
    super('dyyj', 2);
  }

  async search(keyword, ext = {}) {
    // Step 1: Execute search
    const searchResults = await this._executeSearch(keyword);
    if (searchResults.length === 0) return [];

    // Step 2: Filter by title keyword first
    const titleFiltered = this._filterByTitleKeyword(searchResults, keyword);
    if (titleFiltered.length === 0) return [];

    // Step 3: Fetch detail page links concurrently
    const finalResults = await this._fetchDetailLinks(titleFiltered);

    // Step 4: Final keyword filter
    return filterByKeyword(finalResults, keyword);
  }

  async _executeSearch(keyword) {
    const searchURL = `${BASE_URL}/?q=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers: this._getHeaders(),
    }, { timeout: 30000, retries: 2 });

    const bodyString = await resp.text();

    // Try goquery-style parsing first with cheerio
    const $ = cheerio.load(bodyString);
    let results = [];

    // Try multiple selectors
    const selectors = [
      'noscript#flarum-content .container ul li',
      'noscript#flarum-content ul li',
      '#flarum-content .container ul li',
      '.container ul li',
    ];

    let usedSelector = '';
    for (const selector of selectors) {
      if ($(selector).length > 0) {
        usedSelector = selector;
        break;
      }
    }

    if (usedSelector) {
      $(usedSelector).each((i, el) => {
        if (results.length >= MAX_RESULTS) return false;
        const result = this._parseResultItem($, el, i + 1);
        if (result) results.push(result);
      });
    }

    // Fallback: Use regex to extract from noscript content
    if (results.length === 0) {
      results = this._parseSearchResultsWithRegex(bodyString);
    }

    return results;
  }

  _getHeaders() {
    return {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'Referer': BASE_URL + '/',
    };
  }

  _parseResultItem($, el, index) {
    const $el = $(el);
    const $linkEl = $el.find('a');
    if ($linkEl.length === 0) return null;

    const title = ($linkEl.text() || '').trim();
    if (!title) return null;

    let detailURL = $linkEl.attr('href');
    if (!detailURL) return null;

    // Ensure full URL
    if (!detailURL.startsWith('http')) {
      detailURL = detailURL.startsWith('/') ? BASE_URL + detailURL : BASE_URL + '/' + detailURL;
    }

    // Extract ID from URL
    const idMatch = detailURL.match(POST_ID_REGEX);
    const postID = idMatch ? idMatch[1] : `unknown-${index}`;

    return {
      uniqueId: `dyyj-${postID}`,
      title,
      content: '',
      links: [],
      tags: [],
      channel: '',
      datetime: '',
      _detailURL: detailURL,
    };
  }

  _parseSearchResultsWithRegex(htmlContent) {
    const results = [];

    // Try to find noscript#flarum-content content
    const noscriptMatch = htmlContent.match(NOSCRIPT_REGEX);
    const searchArea = noscriptMatch ? noscriptMatch[1] : htmlContent;

    // Match <li> tags with links
    let match;
    const liLinkRegex = /<li[^>]*>\s*<a[^>]*href=["']([^"']*\/d\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/g;
    let i = 0;

    while ((match = liLinkRegex.exec(searchArea)) !== null) {
      if (results.length >= MAX_RESULTS) break;

      let href = match[1];
      let title = (match[2] || '').replace(HTML_TAG_REGEX, '').trim();

      if (!title || !href.includes('/d/')) continue;

      // Ensure full URL
      if (!href.startsWith('http')) {
        href = href.startsWith('/') ? BASE_URL + href : BASE_URL + '/' + href;
      }

      // Extract ID
      const idMatch = href.match(POST_ID_REGEX);
      const postID = idMatch ? idMatch[1] : `regex-${i + 1}`;

      results.push({
        uniqueId: `dyyj-${postID}`,
        title,
        content: '',
        links: [],
        tags: [],
        channel: '',
        datetime: '',
        _detailURL: href,
      });

      i++;
    }

    return results;
  }

  _filterByTitleKeyword(results, keyword) {
    if (!keyword) return results;
    const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    return results.filter(r => {
      const lowerTitle = (r.title || '').toLowerCase();
      return keywords.every(kw => lowerTitle.includes(kw));
    });
  }

  async _fetchDetailLinks(searchResults) {
    if (searchResults.length === 0) return [];

    const finalResults = [];

    for (let i = 0; i < searchResults.length; i += MAX_CONCURRENT) {
      const batch = searchResults.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (result) => {
          const detailURL = result._detailURL;
          if (!detailURL) return null;

          const { links, publishTime } = await this._fetchDetailPageLinks(detailURL);
          if (links.length > 0) {
            const { _detailURL, ...cleanResult } = result;
            return {
              ...cleanResult,
              links,
              datetime: publishTime || new Date().toISOString(),
            };
          }
          return null;
        })
      );

      for (const res of batchResults) {
        if (res.status === 'fulfilled' && res.value) {
          finalResults.push(res.value);
        }
      }
    }

    return finalResults;
  }

  async _fetchDetailPageLinks(detailURL) {
    try {
      const resp = await fetchWithRetry(detailURL, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': BASE_URL + '/',
          'Connection': 'keep-alive',
        },
      }, { timeout: 30000, retries: 2 });

      const body = await resp.text();

      const links = this._parseNetworkDiskLinks(body);
      const publishTime = this._extractPublishTime(body);

      return { links, publishTime };
    } catch (err) {
      return { links: [], publishTime: '' };
    }
  }

  _extractPublishTime(htmlContent) {
    for (const re of PUBLISH_TIME_REGEXES) {
      const match = htmlContent.match(re);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  }

  _parseNetworkDiskLinks(htmlContent) {
    const links = [];
    const seen = new Set();

    // Try cheerio-based extraction first
    const $ = cheerio.load(htmlContent);
    const $postBody = $('noscript#flarum-content .container article .Post-body');

    if ($postBody.length > 0) {
      $postBody.find('p').each((j, pEl) => {
        const $p = $(pEl);
        const $strong = $p.find('strong');
        if ($strong.length === 0) return;

        const strongText = ($strong.text() || '').trim();
        if (!this._isNetworkDiskName(strongText)) return;

        // Look for link in current or next p
        let $linkEl = $p.find('a');
        if ($linkEl.length === 0) {
          const $nextP = $p.next();
          if ($nextP.length > 0) {
            $linkEl = $nextP.find('a');
          }
        }

        if ($linkEl.length > 0) {
          const linkURL = $linkEl.attr('href');
          if (linkURL && !seen.has(linkURL)) {
            const urlType = this._determineCloudType(linkURL);
            if (urlType !== 'others') {
              seen.add(linkURL);
              const password = this._extractPasswordFromURL(linkURL);
              links.push({ type: urlType, url: linkURL, password });
            }
          }
        }
      });
    }

    // Fallback: regex-based extraction
    if (links.length === 0) {
      return this._parseNetworkDiskLinksWithRegex(htmlContent);
    }

    return links;
  }

  _parseNetworkDiskLinksWithRegex(htmlContent) {
    const links = [];
    const seen = new Set();

    for (const pattern of NETWORK_DISK_PATTERNS) {
      let match;
      // Reset regex lastIndex
      pattern.regex.lastIndex = 0;
      while ((match = pattern.regex.exec(htmlContent)) !== null) {
        const linkURL = match[1];
        if (seen.has(linkURL)) continue;

        let urlType = this._determineCloudType(linkURL);
        if (urlType === 'others') urlType = pattern.urlType;

        if (urlType !== 'others') {
          seen.add(linkURL);
          const password = this._extractPasswordFromURL(linkURL);
          links.push({ type: urlType, url: linkURL, password });
        }
      }
    }

    return links;
  }

  _isNetworkDiskName(text) {
    const names = ['夸克', '百度', '阿里', '天翼', '迅雷', '115', '123', '蓝奏'];
    const lowerText = text.toLowerCase();
    return names.some(name => lowerText.includes(name.toLowerCase()));
  }

  _determineCloudType(url) {
    if (url.includes('pan.quark.cn')) return 'quark';
    if (url.includes('drive.uc.cn')) return 'uc';
    if (url.includes('pan.baidu.com')) return 'baidu';
    if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
    if (url.includes('pan.xunlei.com')) return 'xunlei';
    if (url.includes('cloud.189.cn')) return 'tianyi';
    if (url.includes('caiyun.139.com')) return 'mobile';
    if (url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) return '115';
    if (url.includes('123684.com') || url.includes('123685.com') || url.includes('123912.com') || url.includes('123pan.com') || url.includes('123pan.cn') || url.includes('123592.com')) return '123';
    if (url.includes('mypikpak.com')) return 'pikpak';
    if (url.includes('magnet:')) return 'magnet';
    if (url.includes('ed2k://')) return 'ed2k';
    return 'others';
  }

  _extractPasswordFromURL(linkURL) {
    const patterns = [
      /[?&]pwd=([A-Za-z0-9]{4,8})/,
      /[?&]password=([A-Za-z0-9]{4,8})/,
      /[?&]code=([A-Za-z0-9]{4,8})/,
    ];
    for (const p of patterns) {
      const m = linkURL.match(p);
      if (m) return m[1];
    }
    return '';
  }
}

module.exports = Dyyj;
