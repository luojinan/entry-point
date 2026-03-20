/**
 * qupansou 插件 - 趣盘搜 (funletu.com API)
 * 翻译自 Go 插件: plugin/qupansou/qupansou.go
 */

const { BasePlugin, cleanHTML, filterByKeyword, fetchWithRetry } = require('./base');

const API_URL = 'https://v.funletu.com/search';
const DEFAULT_PAGE_SIZE = 1000;

class QupansouPlugin extends BasePlugin {
  constructor() {
    super('qupansou', 3);
  }

  /**
   * 根据URL确定链接类型
   */
  _determineLinkType(url) {
    const lowerURL = url.toLowerCase();
    if (lowerURL.includes('pan.baidu.com')) return 'baidu';
    if (lowerURL.includes('aliyundrive.com') || lowerURL.includes('alipan.com')) return 'aliyun';
    if (lowerURL.includes('pan.quark.cn')) return 'quark';
    if (lowerURL.includes('cloud.189.cn')) return 'tianyi';
    if (lowerURL.includes('pan.xunlei.com')) return 'xunlei';
    if (lowerURL.includes('caiyun.139.com') || lowerURL.includes('www.caiyun.139.com')) return 'mobile';
    if (lowerURL.includes('115.com')) return '115';
    if (lowerURL.includes('drive.uc.cn')) return 'uc';
    if (lowerURL.includes('pan.123.com') || lowerURL.includes('123pan.com')) return '123';
    if (lowerURL.includes('mypikpak.com')) return 'pikpak';
    if (lowerURL.includes('lanzou')) return 'lanzou';
    return 'others';
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    // 构建请求体
    const reqBody = {
      style: 'get',
      datasrc: 'search',
      query: {
        id: '',
        datetime: '',
        courseid: 1,
        categoryid: '',
        filetypeid: '',
        filetype: '',
        reportid: '',
        validid: '',
        searchtext: keyword,
      },
      page: {
        pageSize: DEFAULT_PAGE_SIZE,
        pageIndex: 1,
      },
      order: {
        prop: 'sort',
        order: 'desc',
      },
      message: '请求资源列表数据',
    };

    const resp = await fetchWithRetry(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://pan.funletu.com/',
      },
      body: JSON.stringify(reqBody),
    }, { timeout: 10000, retries: 2 });

    const apiResp = await resp.json();

    // 检查响应状态
    if (apiResp.status !== 200) {
      throw new Error(`API returned error: ${apiResp.message}`);
    }

    // 转换为标准格式
    const results = [];
    if (apiResp.data) {
      for (const item of apiResp.data) {
        if (!item.url) continue;

        const link = {
          url: item.url,
          type: this._determineLinkType(item.url),
          password: '',
        };

        const uniqueId = `qupansou-${item.id}`;

        // 清理标题中的HTML标签
        const title = cleanHTML(item.title || '');

        results.push({
          uniqueId,
          title,
          content: `类别: ${item.category || ''}, 文件类型: ${item.filetype || ''}, 大小: ${item.size || ''}`,
          datetime: item.updatetime || '',
          links: [link],
          tags: [],
          channel: '',
        });
      }
    }

    return results;
  }
}

module.exports = QupansouPlugin;
