const { BasePlugin, getRandomUA, filterByKeyword, fetchWithRetry } = require('./base');

/**
 * bixin 插件 - bixbiy.com Flarum论坛API搜索
 * 搜索移动云盘(caiyun.139.com)资源
 */
class BixinPlugin extends BasePlugin {
  constructor() {
    super('bixin', 3);
    this.baseURL = 'https://www.bixbiy.com/api/discussions';
    this.pageSize = 50;
    this.maxRetries = 2;
  }

  async search(keyword, ext = {}) {
    // Fetch 2 pages concurrently (offset 0 and 50)
    const pages = [0, 1];
    const pagePromises = pages.map(pageIdx =>
      this._fetchPage(keyword, pageIdx * this.pageSize).catch(() => ({ results: [], hasMore: false }))
    );

    const pageResults = await Promise.all(pagePromises);

    let allResults = [];
    for (const page of pageResults) {
      allResults = allResults.concat(page.results);
    }

    // Deduplicate by uniqueId
    const seen = new Set();
    const unique = [];
    for (const r of allResults) {
      if (!seen.has(r.uniqueId)) {
        seen.add(r.uniqueId);
        unique.push(r);
      }
    }

    // Sort by datetime descending
    unique.sort((a, b) => {
      const da = a.datetime ? new Date(a.datetime).getTime() : 0;
      const db = b.datetime ? new Date(b.datetime).getTime() : 0;
      return db - da;
    });

    return filterByKeyword(unique, keyword);
  }

  async _fetchPage(keyword, offset) {
    const apiURL = `${this.baseURL}?filter[q]=${encodeURIComponent(keyword)}&include=mostRelevantPost&page[offset]=${offset}&page[limit]=${this.pageSize}`;

    const resp = await fetchWithRetry(apiURL, {
      headers: {
        'User-Agent': getRandomUA(),
        'X-Forwarded-For': this._generateRandomIP(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    }, { timeout: 10000, retries: this.maxRetries });

    const apiResp = await resp.json();

    // Build post map from included
    const postMap = {};
    if (apiResp.included) {
      for (const post of apiResp.included) {
        postMap[post.id] = post;
      }
    }

    const results = [];
    if (apiResp.data) {
      for (const discussion of apiResp.data) {
        const postID = discussion.relationships?.mostRelevantPost?.data?.id;
        const post = postMap[postID];
        if (!post) continue;

        // Clean HTML content
        const cleanedHTML = this._cleanHTML(post.attributes?.contentHtml || '');

        // Extract mobile cloud links
        const links = this._extractMobileLinksFromText(cleanedHTML);
        if (links.length === 0) continue;

        // Parse time
        let datetime = discussion.attributes?.createdAt || '';

        results.push({
          uniqueId: `bixin-${discussion.id}`,
          title: discussion.attributes?.title || '',
          content: cleanedHTML,
          datetime,
          links,
          channel: '',
          tags: [],
        });
      }
    }

    const hasMore = !!(apiResp.links && apiResp.links.next);
    return { results, hasMore };
  }

  _generateRandomIP() {
    const r = () => Math.floor(Math.random() * 255);
    return `${Math.floor(Math.random() * 223) + 1}.${r()}.${r()}.${Math.floor(Math.random() * 254) + 1}`;
  }

  _cleanHTML(html) {
    // Replace <br> tags
    html = html.replace(/<br\s*\/?>/gi, '\n');

    // Remove HTML tags
    let result = '';
    let inTag = false;
    for (const ch of html) {
      if (ch === '<') { inTag = true; continue; }
      if (ch === '>') { inTag = false; continue; }
      if (!inTag) result += ch;
    }

    // Handle HTML entities
    result = result
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Clean blank lines
    const lines = result.split('\n');
    const cleanedLines = lines.map(l => l.trim()).filter(l => l !== '');
    return cleanedLines.join('\n');
  }

  _extractMobileLinksFromText(content) {
    const lines = content.split('\n');
    const linkInfos = [];
    const passwordInfos = [];

    // First pass: find all links and passwords
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for caiyun.139.com links
      if (line.includes('caiyun.139.com')) {
        const url = this._extractURLFromText(line);
        if (url) {
          linkInfos.push({ link: { url, type: 'mobile', password: '' }, position: i });
        }
      }

      // Check for passwords
      const pwKeywords = ['访问码', '密码'];
      for (const keyword of pwKeywords) {
        if (line.includes(keyword)) {
          let colonPos = line.indexOf(':');
          if (colonPos === -1) colonPos = line.indexOf('\uff1a');
          if (colonPos !== -1 && colonPos + 1 < line.length) {
            const password = line.substring(colonPos + 1).trim();
            if (password.length <= 10) {
              passwordInfos.push({ keyword, position: i, password });
            }
          }
        }
      }
    }

    // Second pass: match passwords to links
    for (const info of linkInfos) {
      // Check URL for password
      const urlPwd = this._extractPasswordFromURL(info.link.url);
      if (urlPwd) {
        info.link.password = urlPwd;
        continue;
      }

      // Find nearest password
      let minDistance = 1000000;
      let closestPassword = '';
      for (const pwInfo of passwordInfos) {
        const distance = Math.abs(pwInfo.position - info.position);
        if (distance < minDistance) {
          minDistance = distance;
          closestPassword = pwInfo.password;
        }
      }
      if (minDistance <= 3) {
        info.link.password = closestPassword;
      }
    }

    return linkInfos.map(info => info.link);
  }

  _extractURLFromText(text) {
    const prefixes = ['http://', 'https://'];
    let start = -1;
    for (const prefix of prefixes) {
      const pos = text.indexOf(prefix);
      if (pos !== -1) { start = pos; break; }
    }
    if (start === -1) return '';

    let end = text.length;
    const endChars = [' ', '\t', '\n', '"', "'", '<', '>', ')', ']', '}', ',', ';'];
    for (const ch of endChars) {
      const pos = text.indexOf(ch, start);
      if (pos !== -1 && pos < end) end = pos;
    }

    return text.substring(start, end);
  }

  _extractPasswordFromURL(url) {
    const params = ['pwd=', 'password=', 'passcode=', 'code='];
    for (const param of params) {
      const pos = url.indexOf(param);
      if (pos !== -1) {
        const start = pos + param.length;
        let end = url.length;
        for (let i = start; i < url.length; i++) {
          if (url[i] === '&' || url[i] === '#') { end = i; break; }
        }
        if (start < end) return url.substring(start, end);
      }
    }
    return '';
  }
}

module.exports = BixinPlugin;
