/**
 * sdso 插件 - SDSO网盘搜索 (sdso.top)
 * 翻译自 Go 插件: plugin/sdso/sdso.go
 */

const crypto = require('crypto');
const { BasePlugin, cleanHTML, filterByKeyword, fetchWithRetry } = require('./base');

// AES解密配置
const AES_KEY = '4OToScUFOaeVTrHE';
const AES_IV = '9CLGao1vHKqm17Oz';

// 支持的网盘类型列表
const SUPPORTED_CLOUD_TYPES = ['baidu', 'quark', 'xunlei', 'ali'];

// 默认每种网盘类型获取页数
const DEFAULT_PAGES_PER_TYPE = 2;

class SDSOPlugin extends BasePlugin {
  constructor() {
    super('sdso', 3);
  }

  /**
   * AES-CBC解密URL
   */
  _decryptURL(encryptedURL) {
    if (!encryptedURL) throw new Error('加密URL不能为空');

    // Base64解码
    const ciphertext = Buffer.from(encryptedURL, 'base64');
    if (ciphertext.length === 0) throw new Error('密文长度为0');
    if (ciphertext.length % 16 !== 0) throw new Error('密文长度不是AES块大小的倍数');

    // AES-CBC解密
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(AES_KEY), Buffer.from(AES_IV));
    decipher.setAutoPadding(true);
    let plaintext = decipher.update(ciphertext, undefined, 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  }

  /**
   * 映射网盘类型
   */
  _mapPanType(from) {
    const lower = (from || '').toLowerCase();
    switch (lower) {
      case 'quark': return 'quark';
      case 'xunlei': return 'xunlei';
      case 'aliyun': case 'ali': return 'aliyun';
      case 'baidu': return 'baidu';
      default: return 'others';
    }
  }

  /**
   * 验证是否为有效的网盘链接
   */
  _isValidPanURL(url) {
    if (!url) return false;
    const validDomains = [
      'pan.quark.cn', 'pan.xunlei.com', 'aliyundrive.com',
      'alipan.com', 'pan.baidu.com',
    ];
    const lowerURL = url.toLowerCase();
    return validDomains.some(domain => lowerURL.includes(domain));
  }

  /**
   * 获取指定网盘类型的单页数据
   */
  async _fetchSinglePageWithType(keyword, pageNo, fromType) {
    const searchURL = `https://sdso.top/api/sd/search?name=${encodeURIComponent(keyword)}&pageNo=${pageNo}&from=${fromType}`;

    const resp = await fetchWithRetry(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Referer': 'https://sdso.top/',
      },
    }, { timeout: 30000, retries: 2 });

    const apiResp = await resp.json();

    if (apiResp.code !== 200) {
      throw new Error(`API错误: ${apiResp.msg}`);
    }

    const results = [];
    if (apiResp.data && apiResp.data.list) {
      for (const item of apiResp.data.list) {
        // 解密网盘链接
        let decryptedURL;
        try {
          decryptedURL = this._decryptURL(item.url);
        } catch (e) {
          continue;
        }

        // 验证是否为有效的网盘链接
        if (!this._isValidPanURL(decryptedURL)) continue;

        // 映射网盘类型
        const panType = this._mapPanType(item.from);
        if (panType === 'others') continue;

        // 清理标题中的HTML标签
        const title = cleanHTML(item.name || '');

        results.push({
          uniqueId: `sdso-${item.id}-${fromType}-${pageNo}`,
          title,
          content: `分享者: ${item.creatorName || ''} | 文件数量: ${item.fileCount || 0} | 网盘类型: ${fromType}`,
          links: [{
            type: panType,
            url: decryptedURL,
            password: '',
          }],
          tags: [item.from || '', item.type || ''].filter(Boolean),
          datetime: item.gmtShare || '',
          channel: '',
        });
      }
    }

    return results;
  }

  /**
   * 搜索
   */
  async search(keyword, ext = {}) {
    // 获取每种网盘类型的页数
    let pagesPerType = DEFAULT_PAGES_PER_TYPE;
    if (ext && typeof ext.pages_per_type === 'number' && ext.pages_per_type > 0) {
      pagesPerType = Math.min(ext.pages_per_type, 5);
    }

    // 并发请求多个网盘类型的多页数据
    const promises = [];
    for (const cloudType of SUPPORTED_CLOUD_TYPES) {
      for (let pageNo = 1; pageNo <= pagesPerType; pageNo++) {
        promises.push(
          this._fetchSinglePageWithType(keyword, pageNo, cloudType)
            .catch(() => []) // 失败的任务返回空数组
        );
      }
    }

    const pageResults = await Promise.all(promises);

    let allResults = [];
    for (const results of pageResults) {
      allResults = allResults.concat(results);
    }

    // 关键词过滤
    return filterByKeyword(allResults, keyword);
  }
}

module.exports = SDSOPlugin;
