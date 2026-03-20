/**
 * 插件基类和通用工具
 */

const crypto = require('crypto');

// 通用 UA 列表
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 生成唯一 ID
 */
function generateUniqueID(pluginName, ...parts) {
  const key = parts.join('|');
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
  return `${pluginName}-${hash}`;
}

/**
 * 清理 HTML 标签
 */
function cleanHTML(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * 判断网盘链接类型
 */
function determineCloudType(url) {
  if (!url) return 'others';
  if (url.includes('pan.quark.cn')) return 'quark';
  if (url.includes('drive.uc.cn')) return 'uc';
  if (url.includes('pan.baidu.com')) return 'baidu';
  if (url.includes('aliyundrive.com') || url.includes('alipan.com')) return 'aliyun';
  if (url.includes('pan.xunlei.com')) return 'xunlei';
  if (url.includes('cloud.189.cn')) return 'tianyi';
  if (url.includes('115.com')) return '115';
  if (url.includes('123pan.com')) return '123';
  if (url.includes('mypikpak.com')) return 'pikpak';
  if (url.includes('pan.qoark.cn')) return 'quark';
  return 'others';
}

/**
 * 混合盘 diskType 映射
 */
function convertDiskType(diskType) {
  const map = {
    'BDY': 'baidu',
    'ALY': 'aliyun',
    'QUARK': 'quark',
    'TIANYI': 'tianyi',
    'UC': 'uc',
    'CAIYUN': 'mobile',
    '115': '115',
    'XUNLEI': 'xunlei',
    '123PAN': '123',
    'PIKPAK': 'pikpak',
  };
  return map[diskType] || 'others';
}

/**
 * 提取提取码
 */
function extractPassword(text) {
  if (!text) return '';
  const patterns = [
    /提取码[：:]\s*([0-9a-zA-Z]+)/,
    /密码[：:]\s*([0-9a-zA-Z]+)/,
    /pwd[=:：]\s*([0-9a-zA-Z]+)/,
    /code[=:：]\s*([0-9a-zA-Z]+)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return '';
}

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的 fetch
 */
async function fetchWithRetry(url, options = {}, { timeout = 10000, retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetchWithTimeout(url, options, timeout);
      if (resp.ok) return resp;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < retries) {
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 200));
    }
  }
  throw lastErr;
}

/**
 * 关键词过滤：结果标题必须包含所有关键词分词
 */
function filterByKeyword(results, keyword) {
  if (!keyword) return results;
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return results;
  return results.filter(r => {
    const title = (r.title || '').toLowerCase();
    return words.every(w => title.includes(w));
  });
}

/**
 * 按 uniqueId 去重
 */
function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.uniqueId)) return false;
    seen.add(r.uniqueId);
    return true;
  });
}

/**
 * 插件基类
 */
class BasePlugin {
  constructor(name, priority = 3) {
    this.name = name;
    this.priority = priority;
  }

  /**
   * 搜索方法，子类必须实现
   * @param {string} keyword
   * @param {object} ext - 扩展参数
   * @returns {Promise<Array<{uniqueId, title, content, links: [{type, url, password}], datetime, tags}>>}
   */
  async search(keyword, ext = {}) {
    throw new Error('search() not implemented');
  }
}

module.exports = {
  BasePlugin,
  getRandomUA,
  generateUniqueID,
  cleanHTML,
  determineCloudType,
  convertDiskType,
  extractPassword,
  fetchWithTimeout,
  fetchWithRetry,
  filterByKeyword,
  deduplicateResults,
  USER_AGENTS,
};
