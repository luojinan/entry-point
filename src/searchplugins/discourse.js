/**
 * discourse - Linux.do Discourse 论坛插件
 * 从 linux.do 搜索 API 获取资源帖子，提取网盘链接
 */

const { BasePlugin, fetchWithRetry, filterByKeyword, cleanHTML } = require('./base');

const SEARCH_URL_TEMPLATE = 'https://linux.do/search.json?q=%s%%20in%%3Atitle%%20%%23resource&page=%d';
const MAX_PAGES = 1;

// Pre-compiled regex patterns for cloud drive links
const QUARK_REGEX = /https:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/g;
const BAIDU_REGEX = /https:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(?:\?pwd=([0-9a-zA-Z]+))?/g;
const ALIYUN_REGEX = /https:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9a-zA-Z]+/g;
const XUNLEI_REGEX = /https:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(?:\?pwd=([0-9a-zA-Z]+))?/g;
const TIANYI_REGEX = /https:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/g;
const UC_REGEX = /https:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+/g;
const PAN115_REGEX = /https:\/\/115\.com\/s\/[0-9a-zA-Z]+/g;
const BAIDU_PWD_REGEX = /(?:提取码|密码|pwd)[：:]\s*([0-9a-zA-Z]{4})/;

class Discourse extends BasePlugin {
  constructor() {
    super('discourse', 2);
  }

  async search(keyword, ext = {}) {
    const maxPages = Math.min(ext.max_pages || MAX_PAGES, 10);
    const startPage = ext.page || 1;
    const encodedKeyword = encodeURIComponent(keyword);

    const allResults = [];
    const seenPostIDs = new Set();

    for (let currentPage = startPage; currentPage < startPage + maxPages; currentPage++) {
      if (currentPage > startPage) {
        await new Promise(r => setTimeout(r, 500));
      }

      const searchURL = SEARCH_URL_TEMPLATE
        .replace('%s', encodedKeyword)
        .replace('%d', currentPage);

      try {
        const resp = await fetchWithRetry(searchURL, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        }, { timeout: 30000, retries: 2 });

        const data = await resp.json();

        if (!data.posts || data.posts.length === 0) break;

        // Build topic map
        const topicMap = {};
        if (data.topics) {
          for (const topic of data.topics) {
            topicMap[topic.id] = topic;
          }
        }

        // Convert posts to results
        const pageResults = this._convertToSearchResults(data.posts, topicMap);

        for (const result of pageResults) {
          // Extract post ID from uniqueId for dedup
          const postIDMatch = result.uniqueId.match(/discourse-(\d+)/);
          const postID = postIDMatch ? postIDMatch[1] : null;

          if (postID && !seenPostIDs.has(postID)) {
            seenPostIDs.add(postID);
            allResults.push(result);
          }
        }

        // Check if more results available
        if (!data.grouped_search_result || !data.grouped_search_result.more_full_page_results) {
          break;
        }
      } catch (err) {
        if (allResults.length > 0) break;
        throw err;
      }
    }

    return allResults;
  }

  _convertToSearchResults(posts, topicMap) {
    const results = [];

    for (const post of posts) {
      const topic = topicMap[post.topic_id] || {
        id: post.topic_id,
        title: '未知标题',
        tags: [],
      };

      // Extract links from blurb
      const links = this._extractNetDiskLinksFromBlurb(post.blurb || '');
      if (links.length === 0) continue;

      const datetime = post.created_at || '';

      results.push({
        uniqueId: `discourse-${post.id}`,
        title: topic.title || topic.fancy_title || '未知标题',
        content: this._cleanContent(post.blurb || ''),
        links,
        tags: topic.tags || [],
        channel: '',
        datetime,
      });
    }

    return results;
  }

  _extractNetDiskLinksFromBlurb(blurb) {
    const links = [];

    // Quark
    const quarkMatches = blurb.match(/https:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/g) || [];
    for (const url of quarkMatches) {
      links.push({ type: 'quark', url, password: '' });
    }

    // Baidu (with password extraction)
    const baiduRegex = /https:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_\-]+(?:\?pwd=([0-9a-zA-Z]+))?/g;
    let baiduMatch;
    while ((baiduMatch = baiduRegex.exec(blurb)) !== null) {
      const link = { type: 'baidu', url: baiduMatch[0], password: '' };
      if (baiduMatch[1]) {
        link.password = baiduMatch[1];
      } else {
        const pwdMatch = blurb.match(BAIDU_PWD_REGEX);
        if (pwdMatch) link.password = pwdMatch[1];
      }
      links.push(link);
    }

    // Aliyun
    const aliyunMatches = blurb.match(/https:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9a-zA-Z]+/g) || [];
    for (const url of aliyunMatches) {
      links.push({ type: 'aliyun', url, password: '' });
    }

    // Xunlei (with password extraction)
    const xunleiRegex = /https:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_\-]+(?:\?pwd=([0-9a-zA-Z]+))?/g;
    let xunleiMatch;
    while ((xunleiMatch = xunleiRegex.exec(blurb)) !== null) {
      const link = { type: 'xunlei', url: xunleiMatch[0], password: '' };
      if (xunleiMatch[1]) link.password = xunleiMatch[1];
      links.push(link);
    }

    // Tianyi
    const tianyiMatches = blurb.match(/https:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/g) || [];
    for (const url of tianyiMatches) {
      links.push({ type: 'tianyi', url, password: '' });
    }

    // UC
    const ucMatches = blurb.match(/https:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+/g) || [];
    for (const url of ucMatches) {
      links.push({ type: 'uc', url, password: '' });
    }

    // 115
    const pan115Matches = blurb.match(/https:\/\/115\.com\/s\/[0-9a-zA-Z]+/g) || [];
    for (const url of pan115Matches) {
      links.push({ type: '115', url, password: '' });
    }

    return links;
  }

  _cleanContent(content) {
    // Remove HTML tags
    content = content.replace(/<[^>]+>/g, '');
    // Decode HTML entities
    content = content.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    // Remove excess whitespace
    content = content.replace(/\s+/g, ' ').trim();
    if (content.length > 200) {
      content = content.substring(0, 200) + '...';
    }
    return content;
  }
}

module.exports = Discourse;
