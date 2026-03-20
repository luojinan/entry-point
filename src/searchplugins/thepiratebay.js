/**
 * thepiratebay 插件 - 海盗湾搜索 (thpibay.xyz)
 * 翻译自 Go 插件: plugin/thepiratebay/thepiratebay.go
 */

const cheerio = require('cheerio');
const { BasePlugin, filterByKeyword, fetchWithRetry } = require('./base');

const SEARCH_URL = 'https://thpibay.xyz/search/%s/1/99/0';
const SEARCH_PAGE_URL = 'https://thpibay.xyz/search/%s/%d/99/0';
const MAX_PAGES = 30;

// 预编译正则表达式
const MAGNET_LINK_REGEX = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s]*/;
const TORRENT_ID_REGEX = /\/torrent\/(\d+)\//;
const TIME_FORMAT1_REGEX = /(\d{2}-\d{2})\s+(\d{2}:\d{2})/;
const TIME_FORMAT2_REGEX = /(\d{2}-\d{2})\s+(\d{4})/;
const FILE_SIZE_REGEX = /Size\s+([0-9.]+)\s*(&nbsp;)?\s*([KMGT]?i?B)/;

class ThePirateBayPlugin extends BasePlugin {
  constructor() {
    super('thepiratebay', 3);
  }

  /**
   * 解析上传时间
   */
  _parseUploadTime(timeStr) {
    if (!timeStr) return '';
    timeStr = timeStr.replace(/&nbsp;/g, ' ');

    // 格式1: "07-28 05:35" (当年)
    let matches = TIME_FORMAT1_REGEX.exec(timeStr);
    if (matches) {
      const currentYear = new Date().getFullYear();
      const fullTimeStr = `${currentYear}-${matches[1]} ${matches[2]}`;
      const d = new Date(fullTimeStr);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // 格式2: "10-30 2023" (历史)
    matches = TIME_FORMAT2_REGEX.exec(timeStr);
    if (matches) {
      const dateStr = `${matches[2]}-${matches[1]}`; // YYYY-MM-DD
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    return new Date().toISOString();
  }

  /**
   * 解析总页数
   */
  _parseTotalPages($) {
    let maxPage = 1;

    // 查找分页链接
    $('table#searchResult').next().find('a').each((i, s) => {
      const href = $(s).attr('href');
      if (!href) return;
      const parts = href.split('/');
      if (parts.length >= 4) {
        const pageNum = parseInt(parts[3], 10);
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      }
    });

    // 也检查分页导航区域
    $("td[colspan='9'] a").each((i, s) => {
      const pageText = $(s).text().trim();
      const pageNum = parseInt(pageText, 10);
      if (!isNaN(pageNum) && pageNum > maxPage) {
        maxPage = pageNum;
      }
    });

    if (maxPage > MAX_PAGES) maxPage = MAX_PAGES;
    return maxPage;
  }

  /**
   * 解析单个搜索结果项
   */
  _parseSearchResultItem($, s) {
    // 获取标题
    const titleElement = $(s).find('.detName a.detLink').first();
    if (titleElement.length === 0) return null;

    let title = titleElement.text().trim();
    if (!title) return null;

    // 优化标题格式：将'.'替换为空格
    title = title.replace(/\./g, ' ');

    let detailURL = titleElement.attr('href') || '';
    if (detailURL.startsWith('/')) {
      detailURL = 'https://thpibay.xyz' + detailURL;
    }

    // 提取种子ID
    const idMatches = TORRENT_ID_REGEX.exec(detailURL);
    if (!idMatches || idMatches.length < 2) return null;
    const torrentID = idMatches[1];

    // 获取磁力链接
    const magnetElement = $(s).find("a[href^='magnet:']").first();
    const magnetURL = magnetElement.attr('href') || '';
    if (!magnetURL || !MAGNET_LINK_REGEX.test(magnetURL)) return null;

    // 获取分类信息
    const tags = [];
    $(s).find('.vertTh a').each((i, elem) => {
      const tag = $(elem).text().trim();
      if (tag) tags.push(tag);
    });

    // 获取种子元数据
    const detDesc = $(s).find('.detDesc').text();

    // 解析上传时间
    const datetime = this._parseUploadTime(detDesc);

    // 提取文件大小信息
    let content = '';
    const sizeMatch = FILE_SIZE_REGEX.exec(detDesc);
    if (sizeMatch) {
      content = `文件大小: ${sizeMatch[1]}${sizeMatch[3]}`;
    }

    // 添加上传信息
    if (content) content += ', ';
    content += `上传信息: ${detDesc.trim()}`;

    // 获取Seeders和Leechers
    const seeders = $(s).find('td').eq(2).text().trim();
    const leechers = $(s).find('td').eq(3).text().trim();
    if (seeders && leechers) {
      content += `, Seeders: ${seeders}, Leechers: ${leechers}`;
    }

    return {
      uniqueId: `thepiratebay-${torrentID}`,
      title,
      content,
      datetime,
      tags,
      links: [{
        type: 'magnet',
        url: magnetURL,
        password: '',
      }],
      channel: '',
    };
  }

  /**
   * 搜索指定页面
   */
  async _searchPage(encodedKeyword, page) {
    let searchURL;
    if (page === 1) {
      searchURL = SEARCH_URL.replace('%s', encodedKeyword);
    } else {
      searchURL = SEARCH_PAGE_URL.replace('%s', encodedKeyword).replace('%d', page);
    }

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://thpibay.xyz/',
      },
    }, { timeout: 10000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 解析分页信息（只在第一页解析）
    let totalPages = 1;
    if (page === 1) {
      totalPages = this._parseTotalPages($);
    }

    // 提取搜索结果
    const results = [];
    $('table#searchResult tr').each((i, s) => {
      if ($(s).hasClass('header')) return;
      const result = this._parseSearchResultItem($, s);
      if (result) results.push(result);
    });

    return { results, totalPages };
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    // 检查是否提供了英文标题参数
    let searchKeyword = keyword;
    if (ext && ext.title_en && typeof ext.title_en === 'string') {
      searchKeyword = ext.title_en;
    }

    const encodedKeyword = encodeURIComponent(searchKeyword);

    // 1. 搜索第一页，获取总页数
    const firstPage = await this._searchPage(encodedKeyword, 1);
    let allResults = [...firstPage.results];

    // 2. 如果有多页，并发搜索其他页面
    let maxPagesToSearch = Math.min(firstPage.totalPages, MAX_PAGES);

    if (maxPagesToSearch > 1) {
      const pagePromises = [];
      for (let page = 2; page <= maxPagesToSearch; page++) {
        pagePromises.push(
          this._searchPage(encodedKeyword, page)
            .then(r => ({ page, results: r.results }))
            .catch(() => ({ page, results: [] }))
        );
      }

      const pageResults = await Promise.all(pagePromises);

      // 按页码顺序合并
      pageResults.sort((a, b) => a.page - b.page);
      for (const pr of pageResults) {
        allResults = allResults.concat(pr.results);
      }
    }

    // 3. 过滤关键词匹配的结果
    return filterByKeyword(allResults, searchKeyword);
  }
}

module.exports = ThePirateBayPlugin;
