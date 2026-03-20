/**
 * ypfxw - 影评分享网插件
 * 搜索文章列表，抓取详情页提取网盘链接
 */

const cheerio = require('cheerio');
const { BasePlugin, fetchWithRetry, filterByKeyword } = require('./base');

const ARTICLE_ID_REGEX = /\/post\/(\d+)\.html/;

const LINK_PATTERNS = [
  { reg: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/, type: 'quark' },
  { reg: /https?:\/\/pan\.quark\.cn\/g\/[0-9A-Za-z]+/, type: 'quark' },
  { reg: /https?:\/\/www\.aliyundrive\.com\/s\/[0-9A-Za-z]+/, type: 'aliyun' },
  { reg: /https?:\/\/www\.aliyundrive\.com\/drive\/folder\/[0-9A-Za-z]+/, type: 'aliyun' },
  { reg: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z\-_]+/, type: 'baidu' },
  { reg: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z\-_]+/, type: 'xunlei' },
  { reg: /https?:\/\/123pan\.com\/s\/[0-9A-Za-z]+/, type: '123' },
];

const PWD_PATTERNS = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/,
  /密码[:：]?\s*([0-9A-Za-z]+)/,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/,
];

class Ypfxw extends BasePlugin {
  constructor() {
    super('ypfxw', 2);
  }

  async search(keyword, ext = {}) {
    const searchURL = `https://ypfxw.com/search.php?q=${encodeURIComponent(keyword)}`;

    const resp = await fetchWithRetry(searchURL, {
      method: 'GET',
      headers: this._commonHeaders('https://ypfxw.com/'),
    }, { timeout: 12000, retries: 2 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Collect search items and their detail URLs
    const items = [];
    $('div.list ul > li').each((_, el) => {
      const item = $(el);
      const titleSel = item.find('div.imgr h2 a');
      const title = (titleSel.text() || '').trim();
      const detailURL = titleSel.attr('href');

      if (!title || !detailURL) return;

      const articleID = this._extractArticleID(detailURL);
      if (!articleID) return;

      const summary = (item.find('div.imgr p').first().text() || '').trim();

      const tags = [];
      const category = (item.find('.info span').first().text() || '').trim();
      if (category) tags.push(category);
      item.find('.info span.tag a').each((_, tag) => {
        const tagText = ($(tag).text() || '').trim();
        if (tagText) tags.push(tagText);
      });

      // Extract time
      let timeText = '';
      const clockNode = item.find('.info span i.fa-clock-o').parent();
      if (clockNode.length > 0) {
        timeText = (clockNode.text() || '').trim();
      }
      const publishTime = this._parsePublishTime(timeText);

      items.push({ title, detailURL, summary, tags, publishTime, articleID });
    });

    // Fetch detail pages in parallel (limited concurrency)
    const concurrency = 12;
    const results = [];

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(item => this._fetchDetailLinks(item))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const res = batchResults[j];
        const item = batch[j];
        if (res.status === 'fulfilled' && res.value && res.value.length > 0) {
          results.push({
            uniqueId: `${this.name}-${item.articleID}`,
            title: item.title,
            content: item.summary,
            links: res.value,
            tags: item.tags,
            datetime: item.publishTime,
            channel: '',
          });
        }
      }
    }

    return filterByKeyword(results, keyword);
  }

  async _fetchDetailLinks(item) {
    const resp = await fetchWithRetry(item.detailURL, {
      method: 'GET',
      headers: this._commonHeaders(item.detailURL),
    }, { timeout: 10000, retries: 1 });

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this._extractNetDiskLinks($);
  }

  _extractNetDiskLinks($) {
    const container = $('.article_content');
    if (container.length === 0) return [];

    const results = [];
    const seen = new Set();

    // From <a> tags
    container.find('a[href]').each((_, node) => {
      const href = ($(node).attr('href') || '').trim();
      if (!href) return;

      const { type, normalized } = this._classifyLink(href);
      if (!type) return;
      if (seen.has(normalized)) return;

      const password = this._extractPassword($, $(node));
      results.push({ type, url: normalized, password });
      seen.add(normalized);
    });

    // From plain text
    const text = container.text();
    const urlRegex = /https?:\/\/[^\s<>"']+/g;
    let match;
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
    for (const pattern of LINK_PATTERNS) {
      const m = raw.match(pattern.reg);
      if (m) {
        return { type: pattern.type, normalized: m[0] };
      }
    }
    return { type: '', normalized: '' };
  }

  _extractPassword($, link) {
    const candidates = [link.text() || ''];

    const title = link.attr('title');
    if (title) candidates.push(title);

    const parent = link.parent();
    if (parent && parent.length > 0) {
      candidates.push(parent.text() || '');
      const next = parent.next();
      if (next.length > 0) candidates.push(next.text() || '');
    }

    const next = link.next();
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
    for (const pattern of PWD_PATTERNS) {
      const m = text.match(pattern);
      if (m) return m[1].trim();
    }
    return '';
  }

  _extractArticleID(detailURL) {
    const m = (detailURL || '').match(ARTICLE_ID_REGEX);
    return m ? m[1] : '';
  }

  _parsePublishTime(value) {
    value = (value || '').trim();
    if (!value) return new Date();

    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;

    return new Date();
  }

  _commonHeaders(referer) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
      'Referer': referer,
    };
  }
}

module.exports = Ypfxw;
