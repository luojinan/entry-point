/**
 * pansearch 插件 - pansearch.me 盘搜
 * 翻译自 Go 插件: plugin/pansearch/pansearch.go
 *
 * 说明：Go 版实现了复杂的 worker pool / 大并发 / 缓存清理。
 * Node 版这里实现「核心能力」：
 * - 自动获取 buildId（从 /search 页 HTML 里提取）
 * - 请求 _next/data/<buildId>/search.json?keyword=...&offset=...
 * - 404 时自动刷新 buildId 并重试
 * - 拉取若干页（默认最多 10 页 = 100 条），再统一去重/过滤
 */

const {
  BasePlugin,
  getRandomUA,
  cleanHTML,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  filterByKeyword,
  deduplicateResults,
} = require('./base');

const WEBSITE_URL = 'https://www.pansearch.me/search';
const BASE_URL_TEMPLATE = 'https://www.pansearch.me/_next/data/%s/search.json';

const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 10; // 核心能力：不追求全量，避免过度请求

const BUILD_ID_REGEX = /"buildId":"([^"]+)"/;
const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/;

let buildIdCache = '';
let buildIdCacheAt = 0;
const BUILD_ID_TTL_MS = 30 * 60 * 1000;

function formatBaseURL(buildId) {
  return BASE_URL_TEMPLATE.replace('%s', buildId);
}

function extractBuildIdFromHTML(html) {
  if (!html) return '';

  const m = BUILD_ID_REGEX.exec(html);
  if (m && m[1]) return m[1];

  const m2 = NEXT_DATA_REGEX.exec(html);
  if (m2 && m2[1]) {
    try {
      const obj = JSON.parse(m2[1]);
      if (obj && typeof obj.buildId === 'string' && obj.buildId) return obj.buildId;
    } catch {
      // ignore
    }
  }

  return '';
}

function extractLinkAndPasswordFromContent(content) {
  // pansearch 返回的 content 往往包含 <a ... href="...">，且可能带 ?pwd=...
  const out = { url: '', password: '' };
  if (!content) return out;

  // 1) href="..."
  const hrefM = content.match(/href\s*=\s*"([^"]+)"/i);
  if (hrefM && hrefM[1]) out.url = hrefM[1];

  // 2) fallback: 直接从文本中抓 URL
  if (!out.url) {
    const urlM = content.match(/https?:\/\/[^\s"'<>]+/);
    if (urlM) out.url = urlM[0];
  }

  // 3) 提取码：优先 URL 参数，其次文本里 regex
  if (out.url) {
    const m = out.url.match(/[?&](?:pwd|password|passcode|code)=([^&#]+)/i);
    if (m && m[1]) {
      try {
        out.password = decodeURIComponent(m[1]);
      } catch {
        out.password = m[1];
      }
    }
  }

  if (!out.password) out.password = extractPassword(cleanHTML(content));
  return out;
}

function extractTitleFromContent(content, keyword) {
  const text = cleanHTML((content || '').replace(/<br\s*\/?\s*>/gi, '\n'));
  const idx = text.indexOf('名称：');
  if (idx >= 0) {
    const rest = text.slice(idx + '名称：'.length);
    const line = rest.split(/\r?\n/)[0].trim();
    if (line) return line;
  }
  return keyword;
}

class PansearchPlugin extends BasePlugin {
  constructor() {
    super('pansearch', 3);
  }

  async _getBuildId() {
    const now = Date.now();
    if (buildIdCache && (now - buildIdCacheAt) < BUILD_ID_TTL_MS) return buildIdCache;

    const resp = await fetchWithRetry(WEBSITE_URL, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      },
    }, { timeout: 8000, retries: 2 });

    const html = await resp.text();
    const buildId = extractBuildIdFromHTML(html);
    if (buildId) {
      buildIdCache = buildId;
      buildIdCacheAt = now;
    }
    return buildId;
  }

  async _fetchPage(keyword, offset, baseURL) {
    const apiURL = `${baseURL}?keyword=${encodeURIComponent(keyword)}&offset=${offset}`;

    const resp = await fetchWithRetry(apiURL, {
      headers: {
        'User-Agent': getRandomUA(),
        'Referer': 'https://www.pansearch.me/',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    }, { timeout: 8000, retries: 1 });

    if (resp.status === 404) {
      const err = new Error('404 Not Found (buildId may be expired)');
      err.code = 404;
      throw err;
    }

    const json = await resp.json();
    return json;
  }

  async search(keyword, ext = {}) {
    const maxPages = Number.isFinite(ext.maxPages) ? Math.max(1, Math.floor(ext.maxPages)) : DEFAULT_MAX_PAGES;

    let buildId = await this._getBuildId();
    if (!buildId) return [];

    let baseURL = formatBaseURL(buildId);

    // 先拿第一页确认 total
    let first;
    try {
      first = await this._fetchPage(keyword, 0, baseURL);
    } catch (e) {
      // 404 时刷新 buildId 再试一次
      if (e && (e.code === 404 || String(e.message || '').includes('404'))) {
        buildIdCache = '';
        buildIdCacheAt = 0;
        buildId = await this._getBuildId();
        if (!buildId) return [];
        baseURL = formatBaseURL(buildId);
        first = await this._fetchPage(keyword, 0, baseURL);
      } else {
        throw e;
      }
    }

    const firstItems = first?.pageProps?.data?.data || [];
    const total = Number(first?.pageProps?.data?.total || 0);

    /** @type {any[]} */
    let items = Array.isArray(firstItems) ? firstItems.slice() : [];

    // 计算后续页数：offset = 10,20,...
    const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
    const needPages = Math.min(maxPages, Math.max(1, totalPages));

    const offsets = [];
    for (let p = 1; p < needPages; p++) offsets.push(p * PAGE_SIZE);

    // 并发获取后续页（简单并发，不做 Go 版极限优化）
    const morePages = await Promise.all(offsets.map(async (offset) => {
      try {
        const data = await this._fetchPage(keyword, offset, baseURL);
        return data?.pageProps?.data?.data || [];
      } catch (e) {
        // 404：单页失败直接忽略（避免全局重试风暴）
        return [];
      }
    }));

    for (const arr of morePages) {
      if (Array.isArray(arr)) items.push(...arr);
    }

    // 以 id 去重（Go 版去重键是 item.ID），最终 uniqueId 仍用 pansearch-<id>
    const itemMap = new Map();
    for (const it of items) {
      if (it && (typeof it.id === 'number' || typeof it.id === 'string')) {
        itemMap.set(String(it.id), it);
      }
    }
    items = Array.from(itemMap.values());

    const results = [];
    for (const it of items) {
      const id = it?.id;
      const content = it?.content || '';
      const pan = it?.pan || '';
      const time = it?.time || '';

      const linkInfo = extractLinkAndPasswordFromContent(content);
      if (!linkInfo.url) continue;

      let linkType = pan;
      if (linkType === 'aliyundrive') linkType = 'aliyun';
      if (!linkType || linkType === 'unknown') linkType = determineCloudType(linkInfo.url);

      const type = linkType || determineCloudType(linkInfo.url);
      if (type === 'others') continue;

      results.push({
        uniqueId: `pansearch-${id}`,
        title: extractTitleFromContent(content, keyword),
        content: cleanHTML(content),
        links: [{ type, url: linkInfo.url, password: linkInfo.password || '' }],
        datetime: time,
        tags: [],
        channel: '',
      });
    }

    // base.js 的 deduplicateResults 是按 uniqueId，但这里仍调用确保万一重复
    return filterByKeyword(deduplicateResults(results), keyword);
  }
}

module.exports = PansearchPlugin;
