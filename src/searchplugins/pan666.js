/**
 * pan666 插件 - pan666.net 资源搜索
 * 翻译自 Go 插件: plugin/pan666/pan666.go
 */

const {
  BasePlugin,
  getRandomUA,
  cleanHTML,
  determineCloudType,
  extractPassword,
  fetchWithRetry,
  filterByKeyword,
} = require('./base');

const BASE_URL = 'https://pan666.net/api/discussions';
const PAGE_SIZE = 50;

// 常见网盘链接（覆盖 pan666.go 里处理的几类，并额外兼容夸克/UC 等）
const URL_REGEX = /https?:\/\/[\w.-]+(?:\/[\w\-./?%&=+#]*)?/g;

function generateRandomIP() {
  const a = Math.floor(Math.random() * 223) + 1; // 1..223
  const b = Math.floor(Math.random() * 255);
  const c = Math.floor(Math.random() * 255);
  const d = Math.floor(Math.random() * 254) + 1; // 1..254
  return `${a}.${b}.${c}.${d}`;
}

function normalizeTextFromHTML(html) {
  // base.cleanHTML() 只去标签，不处理 <br> 换行，这里先把 br 转成换行更利于提取码就近匹配
  if (!html) return '';
  return cleanHTML(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
  );
}

function extractLinksFromText(text) {
  if (!text) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  /** @type {{url:string,type:string,lineIdx:number}[]} */
  const linkInfos = [];
  /** @type {{password:string,lineIdx:number}[]} */
  const passwordInfos = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 采集 URL
    const urls = line.match(URL_REGEX) || [];
    for (const raw of urls) {
      const type = determineCloudType(raw);
      if (type === 'others') continue;

      // 去掉常见尾随符号
      const normalized = raw.replace(/[),.;\]}>"']+$/g, '');
      linkInfos.push({ url: normalized, type, lineIdx: i });
    }

    // 采集 提取码/密码/访问码
    const pwd = extractPassword(line);
    if (pwd && pwd.length <= 10) {
      passwordInfos.push({ password: pwd, lineIdx: i });
    } else {
      // 天翼常见「访问码: xxxx」
      const m = line.match(/访问码[：:]\s*([0-9a-zA-Z]{1,10})/);
      if (m) passwordInfos.push({ password: m[1], lineIdx: i });
    }
  }

  // 关联就近密码（距离<=3行）
  const links = [];
  const seen = new Set();

  for (const info of linkInfos) {
    const key = `${info.type}|${info.url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let password = '';

    // 1) URL 自带参数
    const urlPwd = (() => {
      const m = info.url.match(/[?&](?:pwd|password|passcode|code)=([^&#]+)/i);
      return m ? decodeURIComponent(m[1]) : '';
    })();
    if (urlPwd) password = urlPwd;

    // 2) 同行或邻近行
    if (!password && passwordInfos.length) {
      let best = null;
      let bestDist = Infinity;
      for (const pw of passwordInfos) {
        const dist = Math.abs(pw.lineIdx - info.lineIdx);
        if (dist < bestDist) {
          bestDist = dist;
          best = pw;
        }
      }
      if (best && bestDist <= 3) password = best.password;
    }

    links.push({ type: info.type, url: info.url, password });
  }

  return links;
}

class Pan666Plugin extends BasePlugin {
  constructor() {
    super('pan666', 3);
  }

  async _fetchPage(keyword, offset) {
    const apiURL = `${BASE_URL}?filter[q]=${encodeURIComponent(keyword)}` +
      `&include=mostRelevantPost&page[offset]=${offset}&page[limit]=${PAGE_SIZE}`;

    const resp = await fetchWithRetry(apiURL, {
      headers: {
        'User-Agent': getRandomUA(),
        'X-Forwarded-For': generateRandomIP(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    }, { timeout: 10000, retries: 2 });

    const data = await resp.json();
    return data;
  }

  async search(keyword, ext = {}) {
    // 只抓前 2 页（offset=0,50），与 Go 逻辑一致
    const offsets = [0, PAGE_SIZE];

    const pages = await Promise.all(offsets.map(async (offset, idx) => {
      if (idx > 0) {
        // 增加轻微随机延迟，模拟 Go 版行为
        await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random() * 900)));
      }
      try {
        return await this._fetchPage(keyword, offset);
      } catch (e) {
        return null;
      }
    }));

    /** @type {Array} */
    const results = [];

    for (const page of pages) {
      if (!page || !Array.isArray(page.data) || !Array.isArray(page.included)) continue;

      const postMap = new Map();
      for (const post of page.included) {
        if (post && post.id) postMap.set(String(post.id), post);
      }

      for (const discussion of page.data) {
        const discussionId = discussion && discussion.id ? String(discussion.id) : '';
        const title = discussion?.attributes?.title || '';
        const createdAt = discussion?.attributes?.createdAt || '';
        const postId = discussion?.relationships?.mostRelevantPost?.data?.id;
        if (!discussionId || !title || !postId) continue;

        const post = postMap.get(String(postId));
        const contentHTML = post?.attributes?.contentHtml || post?.attributes?.contentHTML || '';

        const text = normalizeTextFromHTML(contentHTML);
        const links = extractLinksFromText(text);
        if (!links.length) continue;

        results.push({
          uniqueId: `pan666-${discussionId}`,
          title,
          content: '',
          links,
          datetime: createdAt,
          tags: [],
          channel: '',
        });
      }
    }

    // 按 datetime 倒序（createdAt RFC3339 字符串可直接比较，但这里安全起见转 Date）
    results.sort((a, b) => {
      const ta = Date.parse(a.datetime || '') || 0;
      const tb = Date.parse(b.datetime || '') || 0;
      return tb - ta;
    });

    return filterByKeyword(results, keyword);
  }
}

module.exports = Pan666Plugin;
