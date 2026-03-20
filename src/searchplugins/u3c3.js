/**
 * u3c3 插件 - U3C3磁力搜索
 * 翻译自 Go 插件: plugin/u3c3/u3c3.go
 */

const cheerio = require('cheerio');
const { BasePlugin, filterByKeyword, fetchWithRetry } = require('./base');

const BASE_URL = 'https://u3c3u3c3.u3c3u3c3u3c3.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

class U3c3Plugin extends BasePlugin {
  constructor() {
    super('u3c3', 5);
    this._search2 = '';
    this._lastSync = 0;
  }

  /**
   * 从HTML中提取search2参数
   */
  _extractSearch2FromHTML(html) {
    const lines = html.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();

      // 跳过注释行
      if (line.startsWith('//')) continue;

      // 查找包含nmefafej的行
      if (line.includes('nmefafej') && line.includes('"')) {
        // 使用正则提取引号内的值
        const re = /var\s+nmefafej\s*=\s*"([^"]+)"/;
        const matches = re.exec(line);
        if (matches && matches[1].length > 5) {
          return matches[1];
        }

        // 备用方案：直接提取引号内容
        const start = line.indexOf('"');
        if (start !== -1) {
          const end = line.indexOf('"', start + 1);
          if (end !== -1 && (end - start - 1) > 5) {
            return line.slice(start + 1, end);
          }
        }
      }
    }
    return '';
  }

  /**
   * 获取search2参数
   */
  async _getSearch2Parameter() {
    // 如果缓存有效（1小时内），直接返回
    if (this._search2 && (Date.now() - this._lastSync) < 3600000) {
      return this._search2;
    }

    const resp = await fetchWithRetry(BASE_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    }, { timeout: 30000, retries: 2 });

    const body = await resp.text();

    const search2 = this._extractSearch2FromHTML(body);
    if (!search2) {
      throw new Error('无法从首页提取search2参数');
    }

    // 缓存参数
    this._search2 = search2;
    this._lastSync = Date.now();

    return search2;
  }

  /**
   * 清理标题文本
   */
  _cleanTitle(title) {
    // 移除HTML标签
    title = title.replace(/<[^>]*>/g, '');
    // 移除多余的空白字符
    title = title.replace(/\s+/g, ' ');
    return title.trim();
  }

  /**
   * 解析日期时间
   */
  _parseDateTime(dateStr) {
    if (!dateStr) return '';
    const formats = [
      dateStr, // 原始格式尝试
    ];
    for (const fmt of formats) {
      const d = new Date(fmt);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return '';
  }

  /**
   * 生成唯一ID
   */
  _generateUniqueID(title, size) {
    const source = `u3c3-${title}-${size}`;
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
      hash = (hash * 31 + source.charCodeAt(i)) | 0;
    }
    if (hash < 0) hash = -hash;
    return `u3c3-${hash}`;
  }

  /**
   * 解析搜索结果
   */
  _parseSearchResults(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('tbody tr.default').each((i, s) => {
      // 跳过广告行（置顶）
      const titleCell = $(s).find('td:nth-child(2)');
      const titleText = titleCell.text();
      if (titleText.includes('[置顶]')) return;

      // 提取标题和详情链接
      const titleLink = titleCell.find('a');
      let title = titleLink.text().trim();
      if (!title) return;

      title = this._cleanTitle(title);

      let detailURL = titleLink.attr('href') || '';
      if (detailURL && !detailURL.startsWith('http')) {
        detailURL = BASE_URL + detailURL;
      }

      // 提取磁力链接
      const linkCell = $(s).find('td:nth-child(3)');
      const links = [];
      linkCell.find("a[href^='magnet:']").each((j, link) => {
        const href = $(link).attr('href');
        if (href) {
          links.push({ url: href, type: 'magnet', password: '' });
        }
      });

      // 提取文件大小
      const sizeText = $(s).find('td:nth-child(4)').text().trim();

      // 提取上传时间
      const dateText = $(s).find('td:nth-child(5)').text().trim();

      // 提取分类
      const categoryText = $(s).find('td:nth-child(1) a').attr('title') || '';

      // 构建内容信息
      const contentParts = [];
      if (categoryText) contentParts.push(`分类: ${categoryText}`);
      if (sizeText) contentParts.push(`大小: ${sizeText}`);
      if (dateText) contentParts.push(`时间: ${dateText}`);
      const content = contentParts.join(' | ');

      const uniqueId = this._generateUniqueID(title, sizeText);

      results.push({
        uniqueId,
        title,
        content,
        datetime: this._parseDateTime(dateText),
        tags: ['种子', '磁力链接'],
        links,
        channel: '',
      });
    });

    return results;
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    // 第一步：获取search2参数
    const search2 = await this._getSearch2Parameter();

    // 第二步：执行搜索
    const searchURL = `${BASE_URL}/?search2=${search2}&search=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': BASE_URL + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    }, { timeout: 30000, retries: 2 });

    const body = await resp.text();
    const results = this._parseSearchResults(body);

    // 应用关键词过滤
    return filterByKeyword(results, keyword);
  }
}

module.exports = U3c3Plugin;
