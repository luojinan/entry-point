/**
 * fox4k - 极狐4K搜索插件
 * 影视资源搜索，从搜索结果页获取列表（支持分页），再并发获取详情页提取网盘下载链接
 * 排除夸克网盘链接
 */

const cheerio = require('cheerio');
const { BasePlugin, getRandomUA, fetchWithRetry, filterByKeyword } = require('./base');

const BASE_URL = 'https://4kfox.com';
const SEARCH_URL = BASE_URL + '/search/%s-------------.html';
const SEARCH_PAGE_URL = BASE_URL + '/search/%s----------%d---.html';
const DETAIL_URL = BASE_URL + '/video/%s.html';
const MAX_PAGES = 10;
const MAX_CONCURRENT = 50;

// Pre-compiled regexes
const DETAIL_ID_REGEX = /\/video\/(\d+)\.html/;
const YEAR_REGEX = /(\d{4})/;
const QUARK_LINK_REGEX = /https?:\/\/pan\.quark\.cn\/s\/[0-9a-fA-F]+(\?pwd=[0-9a-zA-Z]+)?/;
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s]*/g;
const ED2K_LINK_REGEX = /ed2k:\/\/\|file\|[^|]+\|[^|]+\|[^|]+\|\/?/g;

const PAN_LINK_REGEXES = {
  baidu: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?(?:&v=\d+)?/g,
  aliyun: /https?:\/\/(?:www\.)?alipan\.com\/s\/[0-9a-zA-Z_-]+/g,
  tianyi: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z_-]+(?:\([^)]*\))?/g,
  uc: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-fA-F]+(?:\?[^"\s]*)?/g,
  mobile: /https?:\/\/caiyun\.139\.com\/[^"\s]+/g,
  '115': /https?:\/\/115\.com\/s\/[0-9a-zA-Z_-]+/g,
  pikpak: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z_-]+/g,
  xunlei: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(?:\?pwd=[0-9a-zA-Z]+)?/g,
  '123': /https?:\/\/(?:www\.)?123pan\.com\/s\/[0-9a-zA-Z_-]+/g,
};

const PASSWORD_REGEXES = [
  /\?pwd=([0-9a-zA-Z]+)/,
  /提取码[：:]\s*([0-9a-zA-Z]+)/,
  /访问码[：:]\s*([0-9a-zA-Z]+)/,
  /密码[：:]\s*([0-9a-zA-Z]+)/,
  /（访问码[：:]\s*([0-9a-zA-Z]+)）/,
];

class Fox4k extends BasePlugin {
  constructor() {
    super('fox4k', 3);
  }

  async search(keyword, ext = {}) {
    const encodedKeyword = encodeURIComponent(keyword);

    // 1. Search first page, get total pages
    const { results: firstPageResults, totalPages } = await this._searchPage(encodedKeyword, 1);
    let allResults = [...firstPageResults];

    // 2. Search additional pages concurrently
    const maxPagesToSearch = Math.min(totalPages, MAX_PAGES);
    if (maxPagesToSearch > 1) {
      const pagePromises = [];
      for (let page = 2; page <= maxPagesToSearch; page++) {
        pagePromises.push(this._searchPage(encodedKeyword, page).catch(() => ({ results: [], totalPages: 0 })));
      }
      const pageResults = await Promise.allSettled(pagePromises);
      for (const res of pageResults) {
        if (res.status === 'fulfilled' && res.value.results) {
          allResults.push(...res.value.results);
        }
      }
    }

    // 3. Enrich with detail page info concurrently
    allResults = await this._enrichWithDetailInfo(allResults);

    // 4. Filter by keyword
    return filterByKeyword(allResults, keyword);
  }

  async _searchPage(encodedKeyword, page) {
    const searchURL = page === 1
      ? SEARCH_URL.replace('%s', encodedKeyword)
      : SEARCH_PAGE_URL.replace('%s', encodedKeyword).replace('%d', page);

    const randomUA = getRandomUA();
    const randomIP = this._generateRandomIP();

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers: {
        'User-Agent': randomUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': BASE_URL + '/',
        'X-Forwarded-For': randomIP,
        'X-Real-IP': randomIP,
        'sec-ch-ua-platform': 'macOS',
      },
    }, { timeout: 15000, retries: 3 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Parse total pages
    const totalPages = this._parseTotalPages($);

    // Parse search results
    const results = [];
    $('.hl-list-item').each((i, el) => {
      const result = this._parseSearchResultItem($, el);
      if (result) results.push(result);
    });

    return { results, totalPages };
  }

  _parseTotalPages($) {
    const pageInfo = ($('.hl-page-tips a').text() || '').trim();
    if (!pageInfo) return 1;

    const parts = pageInfo.split('/');
    if (parts.length !== 2) return 1;

    const total = parseInt(parts[1].trim(), 10);
    return isNaN(total) || total < 1 ? 1 : total;
  }

  _parseSearchResultItem($, el) {
    const $el = $(el);

    // Get detail page link
    const $linkEl = $el.find('.hl-item-pic a').first();
    let href = $linkEl.attr('href');
    if (!href) return null;

    if (href.startsWith('/')) href = BASE_URL + href;

    // Extract ID
    const matches = href.match(DETAIL_ID_REGEX);
    if (!matches || matches.length < 2) return null;
    const id = matches[1];

    // Get title
    const title = ($el.find('.hl-item-title a').first().text() || '').trim();
    if (!title) return null;

    // Get status
    const status = ($el.find('.hl-pic-text .remarks').text() || '').trim();

    // Get score
    const score = ($el.find('.hl-text-conch.score').text() || '').trim();

    // Get basic info
    const basicInfo = ($el.find('.hl-item-sub').first().text() || '').trim();
    const description = ($el.find('.hl-item-sub').last().text() || '').trim();

    // Parse year, region, category
    let year = '', region = '', category = '';
    if (basicInfo) {
      const parts = basicInfo.split('·');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part || (score && part.includes(score))) continue;
        if ((i === 0 || (i === 1 && parts[0].includes(score))) && YEAR_REGEX.test(part)) {
          year = part;
        } else if (!region) {
          region = part;
        } else if (!category) {
          category = part;
        } else {
          category += ' ' + part;
        }
      }
    }

    // Build tags
    const tags = [];
    if (status) tags.push(status);
    if (year) tags.push(year);
    if (region) tags.push(region);
    if (category) tags.push(category);

    // Build content
    let content = description;
    if (basicInfo) content = basicInfo + '\n' + description;
    if (score) content = '评分: ' + score + '\n' + content;

    return {
      uniqueId: `fox4k-${id}`,
      title,
      content,
      links: [],
      tags,
      channel: '',
      datetime: '',
      _id: id,
    };
  }

  async _enrichWithDetailInfo(results) {
    if (results.length === 0) return results;

    const enrichedResults = [];

    for (let i = 0; i < results.length; i += MAX_CONCURRENT) {
      const batch = results.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.allSettled(
        batch.map(async (result) => {
          const id = result._id;
          if (!id) return null;

          const detailInfo = await this._getDetailInfo(id);
          if (detailInfo && detailInfo.links.length > 0) {
            const { _id, ...cleanResult } = result;
            // Update content if detail has content
            if (detailInfo.content) cleanResult.content = detailInfo.content;
            // Merge tags
            const existingTags = new Set(cleanResult.tags);
            for (const tag of detailInfo.tags) {
              if (!existingTags.has(tag)) cleanResult.tags.push(tag);
            }
            return { ...cleanResult, links: detailInfo.links };
          }
          return null;
        })
      );

      for (const res of batchResults) {
        if (res.status === 'fulfilled' && res.value) {
          enrichedResults.push(res.value);
        }
      }
    }

    return enrichedResults;
  }

  async _getDetailInfo(id) {
    try {
      const detailURL = DETAIL_URL.replace('%s', id);

      const resp = await fetchWithRetry(detailURL, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Connection': 'keep-alive',
          'Referer': BASE_URL + '/',
        },
      }, { timeout: 15000, retries: 2 });

      const html = await resp.text();
      const $ = cheerio.load(html);

      const detail = { links: [], tags: [], content: '' };

      // Get title
      detail.title = ($('h2.hl-dc-title').text() || '').trim();

      // Get plot
      detail.content = ($('.hl-content-wrap .hl-content-text').text() || '').trim();

      // Extract tags from detail info
      $('.hl-vod-data ul li').each((i, el) => {
        const text = ($(el).text() || '').trim().replace(/：/g, ': ');
        if (text.includes('类型:') || text.includes('地区:') || text.includes('语言:')) {
          detail.tags.push(text);
        }
      });

      // Extract download links
      this._extractDownloadLinks($, html, detail);

      return detail;
    } catch (err) {
      return null;
    }
  }

  _extractDownloadLinks($, htmlContent, detail) {
    const pageText = $.text ? $.text() : '';

    // 1. Extract magnet links
    const magnetMatches = pageText.match(MAGNET_LINK_REGEX) || [];
    for (const link of magnetMatches) {
      this._addDownloadLink(detail, 'magnet', link, '');
    }

    // 2. Extract ed2k links
    const ed2kMatches = pageText.match(ED2K_LINK_REGEX) || [];
    for (const link of ed2kMatches) {
      this._addDownloadLink(detail, 'ed2k', link, '');
    }

    // 3. Extract pan links (excluding quark)
    for (const [panType, regex] of Object.entries(PAN_LINK_REGEXES)) {
      const matches = pageText.match(regex) || [];
      for (const panLink of matches) {
        const password = this._extractPasswordFromText(pageText, panLink);
        this._addDownloadLink(detail, panType, panLink, password);
      }
    }

    // 4. Search in specific download areas
    $('.hl-rb-downlist').each((i, downlistSection) => {
      const $section = $(downlistSection);

      $section.find('.hl-downs-list li').each((k, linkItem) => {
        const $linkItem = $(linkItem);

        // From data-clipboard-text attribute
        const clipboardText = $linkItem.find('.down-copy').attr('data-clipboard-text');
        if (clipboardText) this._processFoundLink(detail, clipboardText, pageText);

        // From href attributes
        $linkItem.find('a').each((l, link) => {
          const href = $(link).attr('href');
          if (href) this._processFoundLink(detail, href, pageText);
        });

        // From text content
        const itemText = ($linkItem.text() || '');
        this._extractLinksFromText(detail, itemText);
      });
    });

    // 5. Search in playlist areas
    $('.hl-rb-playlist').each((i, playlistSection) => {
      const sectionText = ($(playlistSection).text() || '');
      this._extractLinksFromText(detail, sectionText);
    });
  }

  _processFoundLink(detail, link, contextText) {
    if (!link) return;

    // Exclude quark links
    if (QUARK_LINK_REGEX.test(link)) return;

    if (/magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/.test(link)) {
      this._addDownloadLink(detail, 'magnet', link, '');
      return;
    }

    if (/ed2k:\/\/\|file\|/.test(link)) {
      this._addDownloadLink(detail, 'ed2k', link, '');
      return;
    }

    for (const [panType, regex] of Object.entries(PAN_LINK_REGEXES)) {
      // Need a non-global version for test
      const testRegex = new RegExp(regex.source);
      if (testRegex.test(link)) {
        const password = this._extractPasswordFromLink(link) || this._extractPasswordFromText(contextText || '', link);
        this._addDownloadLink(detail, panType, link, password);
        return;
      }
    }
  }

  _extractLinksFromText(detail, text) {
    if (!text) return;
    if (QUARK_LINK_REGEX.test(text)) return;

    const magnetMatches = text.match(MAGNET_LINK_REGEX) || [];
    for (const link of magnetMatches) {
      this._addDownloadLink(detail, 'magnet', link, '');
    }

    const ed2kMatches = text.match(ED2K_LINK_REGEX) || [];
    for (const link of ed2kMatches) {
      this._addDownloadLink(detail, 'ed2k', link, '');
    }

    for (const [panType, regex] of Object.entries(PAN_LINK_REGEXES)) {
      const matches = text.match(regex) || [];
      for (const panLink of matches) {
        const password = this._extractPasswordFromText(text, panLink);
        this._addDownloadLink(detail, panType, panLink, password);
      }
    }
  }

  _extractPasswordFromLink(link) {
    for (const regex of PASSWORD_REGEXES) {
      const matches = link.match(regex);
      if (matches && matches[1]) return matches[1];
    }
    return '';
  }

  _extractPasswordFromText(text, link) {
    const fromLink = this._extractPasswordFromLink(link);
    if (fromLink) return fromLink;

    for (const regex of PASSWORD_REGEXES) {
      const matches = text.match(regex);
      if (matches && matches[1]) return matches[1];
    }
    return '';
  }

  _addDownloadLink(detail, linkType, linkURL, password) {
    if (!linkURL) return;
    if (QUARK_LINK_REGEX.test(linkURL)) return;

    // Check for duplicates
    for (const existing of detail.links) {
      if (existing.url === linkURL) return;
    }

    detail.links.push({ type: linkType, url: linkURL, password: password || '' });
  }

  _generateRandomIP() {
    const segments = [
      [192, 168, Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)],
      [10, Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)],
      [172, 16 + Math.floor(Math.random() * 16), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)],
    ];
    const segment = segments[Math.floor(Math.random() * segments.length)];
    return segment.join('.');
  }
}

module.exports = Fox4k;
