/**
 * shandian 插件 - 闪电搜索 (UC网盘资源)
 * 翻译自 Go 插件: plugin/shandian/shandian.go
 */

const cheerio = require('cheerio');
const { BasePlugin, filterByKeyword, fetchWithRetry } = require('./base');

// 预编译正则表达式
const DETAIL_ID_REGEX = /\/vod\/detail\/id\/(\d+)\.html/;
const UC_LINK_REGEX = /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/;

class ShandianPlugin extends BasePlugin {
  constructor() {
    super('shandian', 2);
  }

  /**
   * 通用请求头
   */
  _getHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'Referer': 'http://1.95.79.193/',
    };
  }

  /**
   * 解析单个搜索结果项
   */
  _parseSearchItem($, s) {
    // 提取详情页链接和ID
    const detailLink = $(s).find('.module-item-pic a').first().attr('href');
    if (!detailLink) return null;

    const matches = DETAIL_ID_REGEX.exec(detailLink);
    if (!matches || matches.length < 2) return null;

    const itemID = matches[1];
    const uniqueId = `shandian-${itemID}`;

    // 提取标题
    const title = $(s).find('.video-info-header h3 a').text().trim();

    // 提取资源质量
    const quality = $(s).find('.video-serial').text().trim();

    // 提取分类信息
    const tags = [];
    $(s).find('.video-info-aux .tag-link a').each((i, tag) => {
      const tagText = $(tag).text().trim();
      if (tagText) tags.push(tagText);
    });

    // 提取导演信息
    let director = '';
    $(s).find('.video-info-items').each((i, item) => {
      const titleText = $(item).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('导演')) {
        director = $(item).find('.video-info-actor a').text().trim();
      }
    });

    // 提取主演信息
    const actors = [];
    $(s).find('.video-info-items').each((i, item) => {
      const titleText = $(item).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('主演')) {
        $(item).find('.video-info-actor a').each((j, actor) => {
          const actorName = $(actor).text().trim();
          if (actorName) actors.push(actorName);
        });
      }
    });

    // 提取剧情简介
    let plot = '';
    $(s).find('.video-info-items').each((i, item) => {
      const titleText = $(item).find('.video-info-itemtitle').text().trim();
      if (titleText.includes('剧情')) {
        plot = $(item).find('.video-info-item').text().trim();
      }
    });

    // 构建内容描述
    const contentParts = [];
    if (quality) contentParts.push(`【${quality}】`);
    if (director) contentParts.push(`导演：${director}`);
    if (actors.length > 0) {
      let actorStr = actors.slice(0, 3).join('、');
      if (actors.length > 3) actorStr += '等';
      contentParts.push(`主演：${actorStr}`);
    }
    if (plot) contentParts.push(plot);

    return {
      uniqueId,
      title,
      content: contentParts.join('\n'),
      links: [], // 稍后从详情页填充
      datetime: '',
      tags,
      channel: '',
      _itemID: itemID, // 内部使用，用于获取详情
    };
  }

  /**
   * 获取详情页的下载链接
   */
  async _fetchDetailLinks(itemID) {
    const detailURL = `http://1.95.79.193/index.php/vod/detail/id/${itemID}.html`;

    try {
      const resp = await fetchWithRetry(detailURL, {
        headers: this._getHeaders(),
      }, { timeout: 6000, retries: 2 });

      const html = await resp.text();
      const $ = cheerio.load(html);

      const links = [];
      const seenURLs = new Set();

      $('#download-list .module-row-one').each((i, s) => {
        // 从data-clipboard-text属性提取链接
        const clipboardText = $(s).find('[data-clipboard-text]').attr('data-clipboard-text');
        if (clipboardText && UC_LINK_REGEX.test(clipboardText) && !seenURLs.has(clipboardText)) {
          seenURLs.add(clipboardText);
          links.push({ type: 'uc', url: clipboardText, password: '' });
        }

        // 也检查直接的href属性
        $(s).find('a[href]').each((j, a) => {
          const linkURL = $(a).attr('href');
          if (linkURL && UC_LINK_REGEX.test(linkURL) && !seenURLs.has(linkURL)) {
            seenURLs.add(linkURL);
            links.push({ type: 'uc', url: linkURL, password: '' });
          }
        });
      });

      return links;
    } catch (e) {
      return [];
    }
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    const searchURL = `http://1.95.79.193/index.php/vod/search/wd/${encodeURIComponent(keyword)}.html`;

    const resp = await fetchWithRetry(searchURL, {
      headers: this._getHeaders(),
    }, { timeout: 8000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 提取搜索结果
    const rawResults = [];
    $('.module-search-item').each((i, s) => {
      const result = this._parseSearchItem($, s);
      if (result && result.uniqueId) {
        rawResults.push(result);
      }
    });

    // 并发获取详情页信息
    const enhancedPromises = rawResults.map(async (result) => {
      const links = await this._fetchDetailLinks(result._itemID);
      result.links = links;
      delete result._itemID;
      return result;
    });

    const enhancedResults = await Promise.all(enhancedPromises);

    // 关键词过滤
    return filterByKeyword(enhancedResults, keyword);
  }
}

module.exports = ShandianPlugin;
