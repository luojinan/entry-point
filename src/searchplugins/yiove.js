/**
 * yiove - YiOVE 论坛搜索插件
 * 从论坛帖子列表搜索，抓取详情页提取网盘链接
 */

const cheerio = require('cheerio');
const { BasePlugin, fetchWithRetry, filterByKeyword } = require('./base');

const BASE_URL = 'https://bbs.yiove.com';
const SEARCH_RESULT_LIMIT = 12;
const DETAIL_LINK_LIMIT = 6;

const LINK_PATTERNS = [
  { reg: /https?:\/\/pan\.quark\.cn\/(?:s|g)\/[0-9A-Za-z]+/, type: 'quark' },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_?=&]+/, type: 'baidu' },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_?=&]+/, type: 'xunlei' },
  { reg: /https?:\/\/(?:www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9A-Za-z]+/, type: 'aliyun' },
  { reg: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/, type: 'uc' },
  { reg: /https?:\/\/(?:www\.)?(123pan\.com|123pan\.cn|123684\.com|123685\.com|123912\.com|123592\.com)\/s\/[0-9A-Za-z]+/, type: '123' },
  { reg: /https?:\/\/(?:www\.)?mypikpak\.com\/s\/[0-9A-Za-z]+/, type: 'pikpak' },
  { reg: /https?:\/\/caiyun\.139\.com\/[^\s<>"']+/, type: 'mobile' },
  { reg: /https?:\/\/tianyi\.cloud\/[^\s<>"']+/, type: 'tianyi' },
  { reg: /magnet:\?xt=urn:btih:[0-9A-Za-z]+/, type: 'magnet' },
  { reg: /ed2k:\/\/[^\s<>"']+/, type: 'ed2k' },
];

const PASSWORD_PATTERNS = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

const TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const THREAD_ID_REGEX = /thread-(\d+)/;

class Yiove extends BasePlugin {
  constructor() {
    super('yiove', 3);
  }

  async search(keyword, ext = {}) {
    const searchKeyword = keyword.trim();
    if (!searchKeyword) throw new Error(`[${this.name}] 关键词不能为空`);

    // Step 1: fetch search results page
    const threads = await this._fetchSearchResults(searchKeyword);
    if (threads.length === 0) {
      return [];
    }

    // Step 2: fetch details in parallel (limited concurrency)
    const results = [];
    const concurrency = 6;

    for (let i = 0; i < threads.length; i += concurrency) {
      const batch = threads.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(thread => this._fetchDetail(thread))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const res = batchResults[j];
        if (res.status === 'fulfilled' && res.value) {
          results.push(res.value);
        }
      }
    }

    return filterByKeyword(results, searchKeyword);
  }

  async _fetchSearchResults(keyword) {
    const encoded = this._encodeKeyword(keyword);
    const searchURL = `${BASE_URL}/search-${encoded}-1.htm`;

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers: this._htmlHeaders(BASE_URL),
    }, { timeout: 12000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    const threads = [];
    $('ul.threadlist li.thread').each((_, li) => {
      if (threads.length >= SEARCH_RESULT_LIMIT) return;

      const subject = $(li).find('.subject a').first();
      const href = (subject.attr('href') || '').trim();
      if (!href) return;

      const title = (subject.text() || '').trim();
      if (!title) return;

      const tags = [];
      $(li).find('.subject a.badge').each((_, node) => {
        const tag = ($(node).text() || '').trim();
        if (tag) tags.push(tag);
      });

      const threadURL = this._toAbsoluteURL(href);
      if (!threadURL) return;

      threads.push({ title, url: threadURL, tags });
    });

    return threads;
  }

  async _fetchDetail(thread) {
    const resp = await fetchWithRetry(thread.url, {
      method: 'GET',
      headers: this._htmlHeaders(thread.url),
    }, { timeout: 12000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Find content area
    let content = $("div.message[isfirst='1']");
    if (content.length === 0) {
      content = $('.message').first();
    }
    if (content.length === 0) {
      content = $.root();
    }

    content.find('script, style').remove();

    const links = this._extractLinks($, content);
    if (links.length === 0) return null;

    // Limit links
    const limitedLinks = links.slice(0, DETAIL_LINK_LIMIT);

    // Extract description
    let description = ($('meta[name="description"]').attr('content') || '').trim();
    if (!description) {
      const text = content.text().trim();
      description = [...text].slice(0, 200).join('');
    }

    // Extract tags
    const detailTags = this._collectTags($);
    const allTags = this._mergeTags(thread.tags, detailTags);

    // Extract datetime
    const datetime = this._extractDatetime($);

    // Build unique ID
    const uniqueId = this._buildUniqueID(thread.url);

    return {
      uniqueId,
      title: thread.title,
      content: description,
      links: limitedLinks,
      datetime,
      tags: allTags,
      channel: '',
    };
  }

  _extractLinks($, selection) {
    const results = [];
    const seen = new Set();

    // Extract from <a> tags
    selection.find('a[href]').each((_, node) => {
      const href = $(node).attr('href') || '';
      const { type, normalized } = this._classifyLink(href);
      if (!type || !normalized) return;
      if (seen.has(normalized)) return;

      const password = this._extractPasswordFromNode($, $(node));
      results.push({ type, url: normalized, password });
      seen.add(normalized);
    });

    // Extract from plain text
    const text = selection.text();
    let match;
    const urlRegex = /https?:\/\/[^\s<>"']+/g;
    while ((match = urlRegex.exec(text)) !== null) {
      const raw = match[0];
      const { type, normalized } = this._classifyLink(raw);
      if (!type) continue;
      if (seen.has(normalized)) continue;

      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + match[0].length + 80);
      const context = text.substring(start, end);
      const password = this._matchPassword(context);

      results.push({ type, url: normalized, password });
      seen.add(normalized);
    }

    return results;
  }

  _classifyLink(raw) {
    raw = (raw || '').trim();
    if (!raw) return { type: '', normalized: '' };

    for (const pattern of LINK_PATTERNS) {
      const m = raw.match(pattern.reg);
      if (m) {
        return { type: pattern.type, normalized: m[0] };
      }
    }
    return { type: '', normalized: '' };
  }

  _extractPasswordFromNode($, node) {
    const candidates = [node.text() || ''];

    const title = node.attr('title');
    if (title) candidates.push(title);

    const parent = node.parent();
    if (parent && parent.length > 0) {
      candidates.push(parent.text() || '');
      const sibling = parent.next();
      if (sibling.length > 0) candidates.push(sibling.text() || '');
    }

    const next = node.next();
    if (next.length > 0) candidates.push(next.text() || '');

    for (const text of candidates) {
      const pwd = this._matchPassword(text);
      if (pwd) return pwd;
    }
    return '';
  }

  _matchPassword(text) {
    text = (text || '').trim();
    if (!text) return '';
    for (const pattern of PASSWORD_PATTERNS) {
      const m = text.match(pattern);
      if (m) return m[1].trim();
    }
    return '';
  }

  _collectTags($) {
    const tagSet = new Set();

    $('.breadcrumb a, ol.breadcrumb a').each((_, node) => {
      const text = ($(node).text() || '').trim();
      if (text && !text.includes('首页')) {
        tagSet.add(text);
      }
    });

    $('h4 a.badge').each((_, node) => {
      const text = ($(node).text() || '').trim();
      if (text) tagSet.add(text);
    });

    return [...tagSet];
  }

  _extractDatetime($) {
    const dateText = ($('.card-thread .date').first().text() || '').trim();
    if (!dateText) return new Date();

    // Try to parse various formats
    const d = new Date(dateText);
    if (!isNaN(d.getTime())) return d;

    return new Date();
  }

  _mergeTags(a, b) {
    const tagSet = new Set();
    for (const tag of (a || [])) {
      const t = (tag || '').trim();
      if (t) tagSet.add(t);
    }
    for (const tag of (b || [])) {
      const t = (tag || '').trim();
      if (t) tagSet.add(t);
    }
    return [...tagSet];
  }

  _encodeKeyword(keyword) {
    keyword = keyword.trim();
    if (!keyword) return '';
    const buf = Buffer.from(keyword, 'utf-8');
    let result = '';
    for (const b of buf) {
      result += '_' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return result;
  }

  _toAbsoluteURL(href) {
    href = (href || '').trim();
    if (!href) return '';
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    return `${BASE_URL}/${href.replace(/^\.\//, '')}`;
  }

  _buildUniqueID(detailURL) {
    const match = detailURL.match(THREAD_ID_REGEX);
    if (match) {
      return `${this.name}-${match[1]}`;
    }
    // fallback: simple hash
    let hash = 0;
    for (let i = 0; i < detailURL.length; i++) {
      hash = ((hash << 5) - hash + detailURL.charCodeAt(i)) | 0;
    }
    return `${this.name}-${Math.abs(hash)}`;
  }

  _htmlHeaders(referer) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Referer': referer,
    };
  }
}

module.exports = Yiove;
