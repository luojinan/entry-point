/**
 * susu 插件 - SuSu网站搜索 (susuifa.com)
 * 翻译自 Go 插件: plugin/susu/susu.go
 */

const cheerio = require('cheerio');
const { BasePlugin, getRandomUA, filterByKeyword, fetchWithRetry } = require('./base');

const SEARCH_URL = 'https://susuifa.com/?type=post&s=%s';
const BUTTON_DETAIL_URL = 'https://susuifa.com/wp-json/b2/v1/getDownloadPageData?post_id=%s&index=0&i=%d&guest=';
const BUTTON_COUNT = 6;

class SusuPlugin extends BasePlugin {
  constructor() {
    super('susu', 1); // 高优先级
  }

  /**
   * 从搜索结果项中提取帖子ID
   */
  _extractPostID($, s) {
    // 方法1：从列表项ID属性提取
    const itemID = $(s).attr('id');
    if (itemID && itemID.startsWith('item-')) {
      return itemID.replace('item-', '');
    }

    // 方法2：从详情页链接提取
    const href = $(s).find('.post-info h2 a').attr('href');
    if (href) {
      const m = href.match(/\/(\d+)\.html/);
      if (m) return m[1];
    }

    return '';
  }

  /**
   * 解码JWT token获取真实链接
   */
  _decodeJWTURL(jwtToken) {
    const parts = jwtToken.split('.');
    if (parts.length !== 3) throw new Error('无效的JWT格式');

    // 解码Payload (base64url)
    let payload = parts[1];
    // 修正base64url格式
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    // 补齐padding
    while (payload.length % 4 !== 0) payload += '=';

    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const data = JSON.parse(decoded);
    return data.data?.url || '';
  }

  /**
   * 根据URL和名称确定链接类型
   */
  _determineLinkType(url, name) {
    const lowerURL = (url || '').toLowerCase();
    const lowerName = (name || '').toLowerCase();

    // 根据URL判断
    if (lowerURL.includes('pan.baidu.com')) return 'baidu';
    if (lowerURL.includes('alipan.com') || lowerURL.includes('aliyundrive.com')) return 'aliyun';
    if (lowerURL.includes('pan.xunlei.com')) return 'xunlei';
    if (lowerURL.includes('pan.quark.cn')) return 'quark';
    if (lowerURL.includes('cloud.189.cn')) return 'tianyi';
    if (lowerURL.includes('115.com')) return '115';
    if (lowerURL.includes('drive.uc.cn')) return 'uc';
    if (lowerURL.includes('caiyun.139.com')) return 'mobile';
    if (lowerURL.includes('123pan.com')) return '123';
    if (lowerURL.includes('mypikpak.com')) return 'pikpak';

    // 根据名称判断
    if (lowerName.includes('百度')) return 'baidu';
    if (lowerName.includes('阿里')) return 'aliyun';
    if (lowerName.includes('迅雷')) return 'xunlei';
    if (lowerName.includes('夸克')) return 'quark';
    if (lowerName.includes('天翼')) return 'tianyi';
    if (lowerName.includes('115')) return '115';
    if (lowerName.includes('uc')) return 'uc';
    if (lowerName.includes('移动') || lowerName.includes('彩云')) return 'mobile';
    if (lowerName.includes('123')) return '123';
    if (lowerName.includes('pikpak')) return 'pikpak';

    return 'others';
  }

  /**
   * 获取按钮详情
   */
  async _getButtonDetail(postID, index) {
    const buttonDetailURL = BUTTON_DETAIL_URL
      .replace('%s', postID)
      .replace('%d', index);

    try {
      const resp = await fetchWithRetry(buttonDetailURL, {
        method: 'POST',
        headers: {
          'User-Agent': getRandomUA(),
          'Content-Type': 'application/json',
          'Referer': `https://susuifa.com/download?post_id=${postID}&index=0&i=${index}`,
        },
      }, { timeout: 10000, retries: 0 });

      const data = await resp.json();

      if (!data.button?.url) return null;

      // 解析JWT token获取真实链接
      const realURL = this._decodeJWTURL(data.button.url);
      if (!realURL) return null;

      return {
        type: this._determineLinkType(realURL, data.button.name || ''),
        url: realURL,
        password: '',
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取网盘链接
   */
  async _getLinks(postID) {
    // 并发发送6个请求
    const promises = [];
    for (let i = 0; i < BUTTON_COUNT; i++) {
      promises.push(this._getButtonDetail(postID, i));
    }

    const results = await Promise.all(promises);
    return results.filter(link => link !== null && link.url);
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    const searchURL = SEARCH_URL.replace('%s', encodeURIComponent(keyword));

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': getRandomUA(),
        'Referer': 'https://susuifa.com/',
      },
    }, { timeout: 10000, retries: 0 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 预先过滤不包含关键词的帖子
    const keywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const items = [];

    $('.post-list-item').each((i, s) => {
      const title = $(s).find('.post-info h2 a').text().trim();
      const lowerTitle = title.toLowerCase();

      const matched = keywords.every(kw => lowerTitle.includes(kw));
      if (matched) items.push(s);
    });

    // 并发处理每个搜索结果项
    const resultPromises = items.map(async (s) => {
      const postID = this._extractPostID($, s);
      if (!postID) return null;

      const title = $(s).find('.post-info h2 a').text().trim();
      const content = $(s).find('.post-excerpt').text().trim();

      // 提取日期时间
      const datetimeStr = $(s).find('.list-footer time.b2timeago').attr('datetime') || '';
      let datetime = '';
      if (datetimeStr) {
        datetime = datetimeStr;
      }

      // 提取分类标签
      const tags = [];
      $(s).find('.post-list-cat-item').each((i, t) => {
        const tag = $(t).text().trim();
        if (tag) tags.push(tag);
      });

      // 获取网盘链接
      let links = [];
      try {
        links = await this._getLinks(postID);
      } catch (e) {
        // 获取链接失败，继续
      }

      return {
        uniqueId: `susu-${postID}`,
        title,
        content,
        datetime,
        links,
        tags,
        channel: '',
      };
    });

    const allResults = await Promise.all(resultPromises);

    // 过滤掉null结果
    return allResults.filter(r => r !== null);
  }
}

module.exports = SusuPlugin;
