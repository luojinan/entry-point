/**
 * panwiki - Panwiki Discuz 论坛搜索插件
 * 翻译自 Go 插件: plugin/panwiki/panwiki.go
 *
 * 搜索 panwiki.com (备用 pan666.net) Discuz 论坛帖子，
 * 解析搜索结果列表，并发获取详情页提取网盘链接。
 */

const { BasePlugin, getRandomUA, generateUniqueID, cleanHTML, fetchWithRetry, filterByKeyword } = require('./base');
const cheerio = require('cheerio');

const PLUGIN_NAME = 'panwiki';
const PRIMARY_BASE_URL = 'https://www.panwiki.com';
const BACKUP_BASE_URL = 'https://pan666.net';
const SEARCH_PATH = '/search.php?mod=forum&srchtxt=%s&searchsubmit=yes&orderby=lastpost';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const MAX_CONCURRENCY = 40;
const MAX_PAGES = 2;

// ===================== 链接正则 =====================
const LINK_PATTERNS = [
  { re: /https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9_-]+/g,   type: 'quark' },
  { re: /https:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+/g,  type: 'baidu' },
  { re: /https:\/\/www\.alipan\.com\/s\/[a-zA-Z0-9_-]+/g,  type: 'aliyun' },
  { re: /https:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9_-]+/g,  type: 'xunlei' },
  { re: /https:\/\/cloud\.189\.cn\/[a-zA-Z0-9_-]+/g,       type: 'tianyi' },
  { re: /https:\/\/pan\.uc\.cn\/s\/[a-zA-Z0-9_-]+/g,       type: 'uc' },
  { re: /https:\/\/www\.123pan\.com\/s\/[a-zA-Z0-9_-]+/g,   type: '123' },
  { re: /https:\/\/www\.123684\.com\/s\/[a-zA-Z0-9_-]+/g,   type: '123' },
  { re: /https:\/\/115cdn\.com\/s\/[a-zA-Z0-9_-]+/g,        type: '115' },
  { re: /https:\/\/pan\.pikpak\.com\/s\/[a-zA-Z0-9_-]+/g,   type: 'pikpak' },
  { re: /https:\/\/caiyun\.139\.cn\/s\/[a-zA-Z0-9_-]+/g,    type: 'mobile' },
];

// ===================== 链接类型判定 =====================
const LINK_TYPE_RULES = [
  { pattern: /pan\.quark\.cn/,    type: 'quark' },
  { pattern: /pan\.baidu\.com/,   type: 'baidu' },
  { pattern: /www\.alipan\.com/,  type: 'aliyun' },
  { pattern: /pan\.xunlei\.com/,  type: 'xunlei' },
  { pattern: /cloud\.189\.cn/,    type: 'tianyi' },
  { pattern: /pan\.uc\.cn/,       type: 'uc' },
  { pattern: /www\.123pan\.com/,  type: '123' },
  { pattern: /www\.123684\.com/,  type: '123' },
  { pattern: /115cdn\.com/,       type: '115' },
  { pattern: /pan\.pikpak\.com/,  type: 'pikpak' },
  { pattern: /caiyun\.139\.cn/,   type: 'mobile' },
];

// 网盘域名列表（用于 containsNetworkLink）
const NETWORK_DOMAINS = [
  'pan.quark.cn', 'pan.baidu.com', 'www.alipan.com', 'caiyun.139.com',
  'pan.xunlei.com', 'drive.uc.cn', 'www.123684.com', '115cdn.com',
  'cloud.189.cn', 'pan.uc.cn', 'www.123pan.com', 'pan.pikpak.com',
];

// 广告清理正则
const AD_PATTERNS = [
  /【[^】]*(?:论坛|网站|\.com|\.net|\.cn)[^】]*】/g,
  /\[[^\]]*(?:论坛|网站|\.com|\.net|\.cn)[^\]]*\]/g,
];

// 密码提取正则
const PASSWORD_PATTERNS = [
  /提取码[：:]\s*([A-Za-z0-9]+)/,
  /密码[：:]\s*([A-Za-z0-9]+)/,
  /pwd[：:=]\s*([A-Za-z0-9]+)/,
  /password[：:=]\s*([A-Za-z0-9]+)/,
];

// 非标题前缀
const NON_TITLE_PREFIXES = [
  '导演:', '编剧:', '主演:', '类型:', '制片国家', '语言:', '首播:',
  '集数:', '单集片长:', '评分:', '简介:', '链接：', '链接:',
  '夸克网盘：', '百度网盘：', '阿里云盘：', '迅雷网盘：',
];

// 作品标题指示词
const TITLE_INDICATORS = [
  '4K持续更新', '集完结', '完结', '4K高码', '持续更新',
  '全集', '集】', '更新', '剧版', '真人版', '动画版',
];

// 单行格式正则
const SINGLE_LINE_PATTERN = /[^丨]*丨[^：]*：https?:\/\/[^\s]+/;

// 单行解析正则
const SINGLE_LINE_EXTRACT = /([^丨]+)丨([^：]+)：(https?:\/\/[a-zA-Z0-9.\-_?=&/]+)/g;

// 请求头
function makeHeaders(baseURL) {
  return {
    'User-Agent': USER_AGENT,
    'Referer': baseURL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

// ===================== 辅助工具函数 =====================

/**
 * 判断链接类型
 */
function determineLinkType(url) {
  for (const rule of LINK_TYPE_RULES) {
    if (rule.pattern.test(url)) return rule.type;
  }
  return '';
}

/**
 * 从文本提取网盘链接
 */
function extractLinksFromText(text) {
  const links = [];
  for (const { re, type } of LINK_PATTERNS) {
    // 每次使用前重置 lastIndex（全局正则）
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      links.push({ url: m[0], type, password: '' });
    }
  }
  return links;
}

/**
 * 从 URL 查询参数提取密码，返回 { normalizedURL, password }
 */
function extractPasswordFromURL(rawURL) {
  try {
    const u = new URL(rawURL);
    const keys = ['pwd', 'password', 'pass', 'code'];
    let password = '';
    for (const k of keys) {
      const v = u.searchParams.get(k);
      if (v) { password = v; break; }
    }
    // 构建去除密码参数后的 URL
    for (const k of keys) {
      u.searchParams.delete(k);
    }
    let normalized = u.toString();
    // 去掉尾部多余的 ?
    if (normalized.endsWith('?')) {
      normalized = normalized.slice(0, -1);
    }
    return { normalizedURL: normalized, password };
  } catch {
    return { normalizedURL: rawURL, password: '' };
  }
}

/**
 * 从内容文本中就近提取密码
 */
function extractPasswordFromContent(content, linkURL) {
  const idx = content.indexOf(linkURL);
  if (idx === -1) return '';

  const start = Math.max(0, idx - 20);
  const end = Math.min(content.length, idx + linkURL.length + 100);
  const surrounding = content.slice(start, end);

  for (const pat of PASSWORD_PATTERNS) {
    const m = surrounding.match(pat);
    if (m) return m[1];
  }

  // 也从 URL 参数中提取
  return extractPasswordFromURL(linkURL).password;
}

/**
 * 清理 HTML 文本
 */
function cleanHtmlText(html) {
  let text = html.replace(/<[^>]*>/g, '');
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return text.trim();
}

/**
 * 清理标题中的广告内容
 */
function cleanTitle(title) {
  title = title.trim();
  for (const pat of AD_PATTERNS) {
    title = title.replace(pat, '');
  }
  return title.trim();
}

/**
 * 去重链接（合并相同资源，优先保留带密码版本）
 */
function deduplicateLinks(links) {
  const map = new Map();
  for (const link of links) {
    const { normalizedURL, password } = extractPasswordFromURL(link.url);
    const newLink = { url: link.url, type: link.type, password: password || link.password || '' };

    if (map.has(normalizedURL)) {
      const existing = map.get(normalizedURL);
      if (newLink.password && !existing.password) {
        map.set(normalizedURL, newLink);
      } else if (!newLink.password && existing.password) {
        // keep existing
      } else if (newLink.url.length > existing.url.length) {
        map.set(normalizedURL, newLink);
      }
    } else {
      map.set(normalizedURL, newLink);
    }
  }
  return Array.from(map.values());
}

/**
 * 是否包含网盘链接
 */
function containsNetworkLink(text) {
  return NETWORK_DOMAINS.some(d => text.includes(d));
}

/**
 * 检测是否是新作品标题
 */
function isNewWorkTitle(text) {
  text = text.trim();
  if (text.length < 3) return false;

  // 1. 包含年份 (2025)
  if (/\(\d{4}\)/.test(text)) return true;

  // 2. 包含分类标签
  if (/\[[^\]]*\]|【[^\]]*】/.test(text)) return true;

  // 3. 包含作品指示词
  for (const ind of TITLE_INDICATORS) {
    if (text.includes(ind)) return true;
  }

  // 4. 集数格式
  if (/【[全\d]+[集\d]*】|【\d+[全集]】|\[\d+[全集]\]|【完结】/.test(text)) return true;

  // 排除非标题
  for (const prefix of NON_TITLE_PREFIXES) {
    if (text.startsWith(prefix)) return false;
  }

  // 5. 纯文本标题检测
  if (!text.includes('http') && !text.includes('<') && !text.includes('>')) {
    const chars = [...text];
    const textLength = chars.length;

    // 短标题（3-6字符），主要是中文
    if (textLength >= 3 && textLength <= 6) {
      let chineseCount = 0;
      for (const ch of chars) {
        const code = ch.codePointAt(0);
        if (code >= 0x4e00 && code <= 0x9fff) chineseCount++;
      }
      if (chineseCount / textLength >= 0.8) return true;
    }

    // 含有中文作品名特征
    if (/^[A-Za-z]*[^\s]*(?:传|剧|版|之|的|与|和|：|丨|\s)+/.test(text)) return true;

    // 长标题（7-50字符）
    if (textLength >= 7 && textLength <= 50) {
      if (/^[\u4e00-\u9fff\w\s\-()（）]+$/.test(text)) return true;
    }
  }

  return false;
}

/**
 * 检查作品标题是否与关键词相关
 */
function isWorkTitleRelevant(title, keyword) {
  const normalizedTitle = title.toLowerCase().replace(/ /g, '').replace(/\./g, '');
  const normalizedKeyword = keyword.toLowerCase().replace(/ /g, '').replace(/\./g, '');

  // 精确匹配
  if (normalizedTitle.includes(normalizedKeyword)) return true;

  return false;
}

/**
 * 检查单行标题是否与关键词相关（一行多个作品时使用）
 */
function isLineTitleRelevant(line, keyword) {
  const workPattern = /([^丨]+)丨[^：]+：/g;
  let m;
  while ((m = workPattern.exec(line)) !== null) {
    const workTitle = m[1].trim();
    if (isWorkTitleRelevant(workTitle, keyword)) return true;
  }
  return false;
}

/**
 * 是否是单行格式（"作品名丨网盘：链接"）
 */
function isSingleLineFormat(lines, keyword) {
  let validLineCount = 0;
  let matchingLineCount = 0;

  for (const line of lines) {
    const cleanLine = cleanHtmlText(line);
    if (cleanLine.trim().length < 10) continue;

    if (SINGLE_LINE_PATTERN.test(cleanLine)) {
      validLineCount++;
      if (isLineTitleRelevant(cleanLine, keyword)) {
        matchingLineCount++;
      }
    }
  }

  return validLineCount >= 2 && matchingLineCount > 0;
}

// ===================== 插件类 =====================

class PanwikiPlugin extends BasePlugin {
  constructor() {
    super(PLUGIN_NAME, 3);
    this.currentBaseURL = PRIMARY_BASE_URL;
  }

  /**
   * 主搜索入口
   */
  async search(keyword, ext = {}) {
    // 每次搜索重置为主域名
    this.currentBaseURL = PRIMARY_BASE_URL;

    // 第一页搜索
    let firstPageResults;
    try {
      firstPageResults = await this.searchPage(keyword, 1);
    } catch (err) {
      // 主域名失败，切换备用
      if (this.currentBaseURL === PRIMARY_BASE_URL) {
        this.currentBaseURL = BACKUP_BASE_URL;
        firstPageResults = await this.searchPage(keyword, 1);
      } else {
        throw err;
      }
    }

    let allResults = [...firstPageResults];

    // 多页搜索（页2..MAX_PAGES）
    if (MAX_PAGES > 1) {
      const pagePromises = [];
      for (let page = 2; page <= MAX_PAGES; page++) {
        const p = page;
        pagePromises.push(
          (async () => {
            // 小延时避免请求过快
            await new Promise(r => setTimeout(r, (p % 3) * 100));
            try {
              return { page: p, results: await this.searchPage(keyword, p) };
            } catch {
              return { page: p, results: [] };
            }
          })()
        );
      }

      const pageResults = await Promise.all(pagePromises);
      // 按页码顺序合并
      pageResults.sort((a, b) => a.page - b.page);
      for (const pr of pageResults) {
        allResults.push(...pr.results);
      }
    }

    // 并发获取详情页链接
    await this.enrichWithDetailLinks(allResults, keyword);

    // 关键词过滤
    return filterByKeyword(allResults, keyword);
  }

  /**
   * 搜索指定页码
   */
  async searchPage(keyword, page) {
    // Step 1: 发起搜索请求，不跟随重定向
    let searchURL = this.getSearchURL(keyword, page);

    let resp;
    try {
      resp = await fetch(searchURL, {
        method: 'GET',
        headers: makeHeaders(this.currentBaseURL),
        redirect: 'manual',
      });
    } catch (err) {
      // 主域名失败，尝试备用
      if (this.currentBaseURL === PRIMARY_BASE_URL) {
        this.currentBaseURL = BACKUP_BASE_URL;
        searchURL = this.getSearchURL(keyword, page);
        resp = await fetch(searchURL, {
          method: 'GET',
          headers: makeHeaders(this.currentBaseURL),
          redirect: 'manual',
        });
      } else {
        throw err;
      }
    }

    // 获取重定向 Location
    const location = resp.headers.get('location') || '';
    if (!location) {
      throw new Error('未获取到重定向URL');
    }

    // 构建完整重定向 URL
    let resultURL;
    if (location.startsWith('http')) {
      resultURL = location;
    } else {
      resultURL = this.currentBaseURL + '/' + location.replace(/^\//, '');
    }

    // 如果不是第一页，修改 page 参数
    if (page > 1) {
      const searchidMatch = resultURL.match(/searchid=(\d+)/);
      if (searchidMatch) {
        const searchid = searchidMatch[1];
        resultURL = `${this.currentBaseURL}/search.php?mod=forum&searchid=${searchid}&orderby=lastpost&ascdesc=desc&searchsubmit=yes&page=${page}`;
      }
    }

    // Step 2: 请求实际搜索结果页
    const resp2 = await fetchWithRetry(resultURL, {
      headers: makeHeaders(this.currentBaseURL),
    }, { timeout: 15000, retries: 2 });

    if (!resp2.ok) {
      throw new Error(`搜索请求返回状态码: ${resp2.status}`);
    }

    const html = await resp2.text();
    const $ = cheerio.load(html);

    return this.extractSearchResults($);
  }

  /**
   * 构建搜索 URL
   */
  getSearchURL(keyword, page) {
    let url = this.currentBaseURL + SEARCH_PATH.replace('%s', encodeURIComponent(keyword));
    if (page > 1) {
      url += `&page=${page}`;
    }
    return url;
  }

  /**
   * 从搜索结果页提取结果列表
   */
  extractSearchResults($) {
    const results = [];

    $('.slst ul li.pbw').each((i, el) => {
      const s = $(el);
      const result = this.parseSearchResult($, s);
      if (result && result.title) {
        results.push(result);
      }
    });

    return results;
  }

  /**
   * 解析单个搜索结果
   */
  parseSearchResult($, s) {
    // 提取标题和详情页链接
    const titleLink = s.find('h3.xs3 a').first();
    const title = cleanTitle(titleLink.text());
    let detailPath = titleLink.attr('href') || '';

    let detailURL = '';
    if (detailPath) {
      if (detailPath.startsWith('http')) {
        detailURL = detailPath;
      } else {
        detailURL = this.currentBaseURL + '/' + detailPath.replace(/^\//, '');
      }
    }

    // 提取内容摘要（第二个 p 标签）
    let content = '';
    s.find('p').each((i, pEl) => {
      if (i === 1) {
        content = $(pEl).text().trim();
      }
    });

    // 提取统计信息
    const statsText = s.find('p.xg1').first().text();

    // 提取时间、作者、分类
    let publishTime = '';
    let author = '';
    let category = '';
    const lastP = s.find('p').last();
    const spans = lastP.find('span');
    if (spans.length >= 3) {
      publishTime = $(spans[0]).text().trim();
      author = $(spans[1]).find('a').text().trim();
      category = $(spans[2]).find('a').text().trim();
    }

    // 丰富内容
    let enrichedContent = content;
    if (author || category) {
      enrichedContent = `${content} | 作者: ${author} | 分类: ${category} | 详情: ${detailURL}`;
    } else if (detailURL) {
      enrichedContent = `${content} | 详情: ${detailURL}`;
    }

    // 从详情页 URL 中提取帖子 ID
    let postID = '';
    if (detailURL) {
      const tidMatch = detailURL.match(/tid=(\d+)/);
      if (tidMatch) postID = tidMatch[1];
    }
    if (!postID) {
      postID = String(Date.now()) + String(Math.floor(Math.random() * 10000));
    }

    // 解析时间
    const datetime = this.parseTime(publishTime);

    return {
      uniqueId: `${PLUGIN_NAME}-${postID}`,
      title,
      content: enrichedContent,
      links: [],
      channel: '',
      datetime,
      tags: [],
      // 内部字段，用于后续获取详情
      _detailURL: detailURL,
    };
  }

  /**
   * 解析时间字符串
   */
  parseTime(timeStr) {
    if (!timeStr) return new Date().toISOString();
    timeStr = timeStr.trim();

    // 尝试多种格式 "2025-8-14 21:21"
    const m = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (m) {
      const [, year, month, day, hour, minute, second] = m;
      const d = new Date(
        parseInt(year), parseInt(month) - 1, parseInt(day),
        parseInt(hour), parseInt(minute), parseInt(second || '0')
      );
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    return new Date().toISOString();
  }

  /**
   * 并发获取详情页链接（最多 MAX_CONCURRENCY 个并发）
   */
  async enrichWithDetailLinks(results, keyword) {
    if (results.length === 0) return;

    const runTask = (index) => {
      return (async () => {
        const result = results[index];
        const detailURL = this.extractDetailURLFromContent(result.content) || result._detailURL || '';
        if (!detailURL) return;

        // 小延时避免请求过快
        await new Promise(r => setTimeout(r, (index % 3) * 50));

        try {
          const links = await this.fetchDetailPageLinksWithKeyword(detailURL, keyword);
          if (links.length > 0) {
            result.links = [...result.links, ...links];
          }
        } catch {
          // 忽略单个详情页失败
        }
      })();
    };

    // 分批并发：每批最多 MAX_CONCURRENCY 个
    for (let start = 0; start < results.length; start += MAX_CONCURRENCY) {
      const batch = [];
      const end = Math.min(start + MAX_CONCURRENCY, results.length);
      for (let i = start; i < end; i++) {
        batch.push(runTask(i));
      }
      await Promise.all(batch);
    }

    // 清理内部字段
    for (const r of results) {
      delete r._detailURL;
    }
  }

  /**
   * 从 Content 字段中提取详情页 URL
   */
  extractDetailURLFromContent(content) {
    const m = content.match(/详情:\s*(https?:\/\/[^\s]+)/);
    return m ? m[1] : '';
  }

  /**
   * 获取详情页链接（带关键词过滤）
   */
  async fetchDetailPageLinksWithKeyword(detailURL, keyword) {
    if (!detailURL) return [];

    const resp = await fetchWithRetry(detailURL, {
      headers: makeHeaders(this.currentBaseURL),
    }, { timeout: 15000, retries: 1 });

    if (!resp.ok) return [];

    const html = await resp.text();
    const $ = cheerio.load(html);

    return this.extractDetailPageLinksWithFilter($, keyword);
  }

  /**
   * 智能过滤版详情页链接提取
   */
  extractDetailPageLinksWithFilter($, keyword) {
    // 查找主要内容区域
    let contentArea = $(".t_f[id^='postmessage_']").first();
    if (contentArea.length === 0) {
      contentArea = $('.t_msgfont, .plhin, .message, [id^="postmessage_"]').first();
    }
    if (contentArea.length === 0) return [];

    // 先直接提取所有链接
    const allFoundLinks = this.extractAllLinksDirectly($, contentArea);

    // 核心策略：4 个或以下直接返回，超过 4 个才进行内容匹配
    if (allFoundLinks.length <= 4) {
      return allFoundLinks;
    }

    // 超过 4 个链接，需要精确匹配
    const htmlContent = contentArea.html() || '';
    const lines = htmlContent.split('\n');

    // 检查是否是单行格式
    if (isSingleLineFormat(lines, keyword)) {
      return this.extractLinksFromSingleLineFormat(lines, keyword);
    }

    // 非单行格式，使用分组逻辑
    return this.extractLinksWithGrouping(htmlContent, keyword);
  }

  /**
   * 直接提取所有网盘链接（简单情况 <= 4 个链接）
   */
  extractAllLinksDirectly($, contentArea) {
    const links = [];

    // 从 a 标签提取
    contentArea.find('a').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const linkType = determineLinkType(href);
      if (linkType) {
        const password = extractPasswordFromContent(contentArea.text(), href);
        links.push({ url: href, type: linkType, password });
      }
    });

    // 从文本中提取
    const contentText = contentArea.text();
    const textLinks = extractLinksFromText(contentText);
    links.push(...textLinks);

    return deduplicateLinks(links);
  }

  /**
   * 从单行格式中提取链接
   */
  extractLinksFromSingleLineFormat(lines, keyword) {
    const allLinks = [];

    for (const line of lines) {
      const cleanLine = cleanHtmlText(line);
      if (cleanLine.trim().length < 10) continue;

      if (cleanLine.includes('\u4E28') && cleanLine.includes('\uFF1A')) {
        // 包含"丨"和"："
        const relevantLinks = this.extractLinksFromSingleLine(cleanLine, keyword);
        allLinks.push(...relevantLinks);
      }
    }

    return deduplicateLinks(allLinks);
  }

  /**
   * 从单行提取"作品名丨网盘：链接"格式的相关链接
   */
  extractLinksFromSingleLine(line, keyword) {
    const results = [];

    // 重置全局正则
    SINGLE_LINE_EXTRACT.lastIndex = 0;
    let m;
    while ((m = SINGLE_LINE_EXTRACT.exec(line)) !== null) {
      const workName = m[1].trim();
      const url = m[3].trim();

      if (isWorkTitleRelevant(workName, keyword)) {
        const linkType = determineLinkType(url);
        if (linkType) {
          const { password } = extractPasswordFromURL(url);
          results.push({ url, type: linkType, password });
        }
      }
    }

    return results;
  }

  /**
   * 使用分组逻辑提取链接（复杂情况）
   */
  extractLinksWithGrouping(htmlContent, keyword) {
    const lines = htmlContent.split('\n');
    let allLinks = [];
    let currentGroup = [];
    let isRelevantGroup = false;

    for (const line of lines) {
      const cleanLine = cleanHtmlText(line);

      if (cleanLine.trim().length < 5) continue;

      const isTitle = isNewWorkTitle(cleanLine);
      if (isTitle) {
        // 处理之前的组
        if (currentGroup.length > 0 && isRelevantGroup) {
          const groupLinks = this.extractLinksFromGroup(currentGroup);
          allLinks.push(...groupLinks);
        }

        // 开始新组
        currentGroup = [line];
        isRelevantGroup = isWorkTitleRelevant(cleanLine, keyword);
      } else {
        if (currentGroup.length > 0) {
          currentGroup.push(line);
        }
      }
    }

    // 处理最后一组
    if (currentGroup.length > 0 && isRelevantGroup) {
      const groupLinks = this.extractLinksFromGroup(currentGroup);
      allLinks.push(...groupLinks);
    }

    return deduplicateLinks(allLinks);
  }

  /**
   * 从作品组中提取链接
   */
  extractLinksFromGroup(group) {
    const links = [];
    const groupHTML = group.join('\n');
    const $ = cheerio.load('<div>' + groupHTML + '</div>');

    // 从 a 标签
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const linkType = determineLinkType(href);
      if (linkType) {
        links.push({ url: href, type: linkType, password: '' });
      }
    });

    // 从文本
    const text = $.root().text();
    const textLinks = extractLinksFromText(text);
    links.push(...textLinks);

    return links;
  }
}

module.exports = PanwikiPlugin;
