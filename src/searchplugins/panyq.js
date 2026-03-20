/**
 * panyq 插件 - 盘友圈 panyq.com
 * 翻译自 Go 插件: plugin/panyq/panyq.go
 *
 * 说明：
 * - 盘友圈是一个 Next.js 应用，搜索流程包含4步：
 *   1. 从网站 JS bundle 中发现 Action ID（credential / intermediate / final_link）
 *   2. 用 credential_action_id POST 获取搜索凭证 (sign, hash, sha)
 *   3. 用 sign 请求 /api/search 获取搜索结果列表
 *   4. 对每个结果执行 intermediate 步骤后获取 final link
 * - Action ID 缓存在模块级变量中，无需文件持久化
 * - 使用 Promise.allSettled 进行并发处理
 */

const {
  BasePlugin,
  generateUniqueID,
  fetchWithRetry,
  filterByKeyword,
} = require('./base');

const BASE_URL = 'https://panyq.com';
const MAX_PAGES = 3;
const DEFAULT_TIMEOUT = 15000;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const SEC_CH_UA = '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"';

// Action ID keys
const ACTION_ID_KEYS = [
  'credential_action_id',
  'intermediate_action_id',
  'final_link_action_id',
];

// Module-level caches
let actionIDCache = {};

/**
 * Clean escaped HTML tags from text (Unicode-escaped and literal)
 */
function cleanEscapedHTML(text) {
  if (!text) return '';
  let result = text;

  // Unicode-escaped tags
  const unicodeReplacements = [
    [/\\u003C\/?mark\\u003E/gi, ''],
    [/\\u003C\/?b\\u003E/gi, ''],
    [/\\u003C\/?em\\u003E/gi, ''],
    [/\\u003C\/?strong\\u003E/gi, ''],
    [/\\u003C\/?i\\u003E/gi, ''],
    [/\\u003C\/?u\\u003E/gi, ''],
    [/\\u003Cbr\s*\/?\s*\\u003E/gi, ' '],
  ];

  for (const [pat, rep] of unicodeReplacements) {
    result = result.replace(pat, rep);
  }

  // Decoded Unicode (actual < > characters)
  const htmlReplacements = [
    [/<\/?mark>/gi, ''],
    [/<\/?b>/gi, ''],
    [/<\/?em>/gi, ''],
    [/<\/?strong>/gi, ''],
    [/<\/?i>/gi, ''],
    [/<\/?u>/gi, ''],
    [/<br\s*\/?>/gi, ' '],
  ];

  for (const [pat, rep] of htmlReplacements) {
    result = result.replace(pat, rep);
  }

  return result;
}

/**
 * Extract title from description text
 */
function extractTitle(desc) {
  const cleanDesc = cleanEscapedHTML(desc);

  // 1. Try matching content inside Chinese book marks 《》
  const bookMatch = cleanDesc.match(/《([^》]+)》/);
  if (bookMatch) return bookMatch[1];

  // 2. Try matching content inside 【】
  const bracketMatch = cleanDesc.match(/【([^】]+)】/);
  if (bracketMatch) return bracketMatch[1];

  // 3. Split by check mark and take first part
  const parts = cleanDesc.split('✔');
  if (parts.length > 0 && parts[0].trim().length > 0) {
    return parts[0].trim();
  }

  // 4. Truncate to 30 characters
  if (cleanDesc.length > 30) {
    return cleanDesc.slice(0, 30).trim() + '...';
  }

  return cleanDesc.trim();
}

/**
 * Determine link type from URL
 */
function determineLinkType(url) {
  if (!url) return 'others';
  const lower = url.toLowerCase();

  if (lower.includes('pan.baidu.com')) return 'baidu';
  if (lower.includes('alipan.com') || lower.includes('aliyundrive.com')) return 'aliyun';
  if (lower.includes('pan.xunlei.com')) return 'xunlei';
  if (lower.includes('cloud.189.cn')) return 'tianyi';
  if (lower.includes('caiyun.139.com') || lower.includes('yun.139.com')) return 'mobile';
  if (lower.includes('pan.quark.cn')) return 'quark';
  if (lower.includes('115.com')) return '115';
  if (lower.includes('weiyun.com')) return 'weiyun';
  if (lower.includes('lanzou')) return 'lanzou';
  if (lower.includes('123pan.com')) return '123';
  if (lower.includes('drive.uc.cn')) return 'uc';
  if (lower.includes('mypikpak.com')) return 'pikpak';
  if (lower.startsWith('magnet:')) return 'magnet';
  if (lower.startsWith('ed2k:')) return 'ed2k';
  return 'others';
}

/**
 * Extract password from URL based on link type
 */
function extractLinkPassword(url, linkType) {
  if (!url) return '';

  if (linkType === 'baidu') {
    const m = url.match(/[?&]pwd=([^&#]+)/);
    if (m) {
      const pwd = m[1];
      return pwd.length >= 4 ? pwd.slice(0, 4) : pwd;
    }
  }

  if (linkType === 'aliyun') {
    const m = url.match(/[?&]password=([^&#]+)/);
    if (m) return m[1];
  }

  return '';
}

/**
 * Build common headers
 */
function commonHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'sec-ch-ua': SEC_CH_UA,
    'Origin': BASE_URL,
    ...extra,
  };
}

class PanyqPlugin extends BasePlugin {
  constructor() {
    super('panyq', 2);
  }

  /**
   * Get or discover Action IDs (with caching)
   */
  async getOrDiscoverActionIDs() {
    // Check cache
    if (Object.keys(actionIDCache).length >= ACTION_ID_KEYS.length) {
      const allPresent = ACTION_ID_KEYS.every(k => actionIDCache[k]);
      if (allPresent) return { ...actionIDCache };
    }

    return this.discoverActionIDs();
  }

  /**
   * Find potential Action IDs from website JS bundles
   */
  async findPotentialActionIDs() {
    // Fetch homepage
    const resp = await fetchWithRetry(BASE_URL, {
      headers: commonHeaders(),
    }, { timeout: DEFAULT_TIMEOUT, retries: 2 });

    const html = await resp.text();

    // Extract JS file paths
    const jsRegex = /<script src="(\/_next\/static\/[^"]+\.js)"/g;
    const jsFiles = [];
    let m;
    while ((m = jsRegex.exec(html)) !== null) {
      jsFiles.push(m[1]);
    }

    if (jsFiles.length === 0) {
      throw new Error('No JS files found on homepage');
    }

    // Fetch each JS file and extract 40-char hex strings
    const idSet = new Set();
    const idRegex = /["']([a-f0-9]{40})["']/g;

    const fetchPromises = jsFiles.map(async (jsPath) => {
      try {
        const jsURL = BASE_URL + jsPath;
        const jsResp = await fetchWithRetry(jsURL, {
          headers: commonHeaders({
            'Referer': BASE_URL,
          }),
        }, { timeout: DEFAULT_TIMEOUT, retries: 1 });
        const jsBody = await jsResp.text();

        let idMatch;
        while ((idMatch = idRegex.exec(jsBody)) !== null) {
          idSet.add(idMatch[1]);
        }
        // Reset lastIndex for re-use with same regex
        idRegex.lastIndex = 0;
      } catch {
        // Ignore individual JS fetch failures
      }
    });

    await Promise.all(fetchPromises);

    return Array.from(idSet);
  }

  /**
   * Get search credentials by POSTing with credential_action_id
   */
  async getCredentials(query, actionID) {
    const payload = JSON.stringify([{ cat: 'all', query, pageNum: 1 }]);

    const resp = await fetchWithRetry(BASE_URL, {
      method: 'POST',
      headers: commonHeaders({
        'Content-Type': 'text/plain;charset=UTF-8',
        'next-action': actionID,
        'Referer': BASE_URL,
      }),
      body: payload,
    }, { timeout: DEFAULT_TIMEOUT, retries: 0 });

    const body = await resp.text();

    const signMatch = body.match(/"sign":"([^"]+)"/);
    const shaMatch = body.match(/"sha":"([a-f0-9]{64})"/);
    const hashMatch = body.match(/"hash","([^"]+)"/);

    if (!signMatch || !shaMatch || !hashMatch) {
      throw new Error('Failed to extract credentials');
    }

    return {
      sign: signMatch[1],
      sha: shaMatch[1],
      hash: hashMatch[1],
    };
  }

  /**
   * Get search results from API
   */
  async getSearchResults(sign, pageNum) {
    const searchURL = `${BASE_URL}/api/search?sign=${sign}&page=${pageNum}`;

    const headers = commonHeaders({
      'Referer': BASE_URL,
    });

    // Add credential_action_id if cached
    if (actionIDCache[ACTION_ID_KEYS[0]]) {
      headers['next-action'] = actionIDCache[ACTION_ID_KEYS[0]];
    }

    const resp = await fetchWithRetry(searchURL, {
      headers,
    }, { timeout: DEFAULT_TIMEOUT, retries: 0 });

    const data = await resp.json();

    const hits = (data && data.data && data.data.hits) || [];
    const maxPageNum = (data && data.data && data.data.maxPageNum) || 0;

    return { hits, maxPageNum };
  }

  /**
   * Perform intermediate step
   */
  async performIntermediateStep(actionID, hashVal, shaVal, eid) {
    const intermediateURL = `${BASE_URL}/search/${hashVal}`;

    const routerStateTree = [
      '',
      {
        children: [
          'search',
          {
            children: [
              ['hash', hashVal, 'd'],
              {
                children: ['__PAGE__', {}, `/search/${hashVal}`, 'refresh'],
              },
            ],
          },
        ],
      },
      null,
      null,
      true,
    ];

    const routerStateTreeEncoded = encodeURIComponent(JSON.stringify(routerStateTree));
    const payload = JSON.stringify([{ eid, sha: shaVal, page_num: '1' }]);

    const resp = await fetchWithRetry(intermediateURL, {
      method: 'POST',
      headers: commonHeaders({
        'Content-Type': 'text/plain;charset=UTF-8',
        'next-action': actionID,
        'Referer': intermediateURL,
        'next-router-state-tree': routerStateTreeEncoded,
      }),
      body: payload,
    }, { timeout: DEFAULT_TIMEOUT, retries: 0 });

    if (!resp.ok) {
      throw new Error(`Intermediate step failed with status ${resp.status}`);
    }
  }

  /**
   * Get raw final link response text
   */
  async getRawFinalLinkResponse(actionID, eid) {
    const finalURL = `${BASE_URL}/go/${eid}`;

    const routerStateTree = [
      '',
      {
        children: [
          'go',
          {
            children: [
              ['eid', eid, 'd'],
              {
                children: ['__PAGE__', {}, `/go/${eid}`, 'refresh'],
              },
            ],
          },
        ],
      },
      null,
      null,
      true,
    ];

    const routerStateTreeEncoded = encodeURIComponent(JSON.stringify(routerStateTree));
    const payload = JSON.stringify([{ eid }]);

    const resp = await fetchWithRetry(finalURL, {
      method: 'POST',
      headers: commonHeaders({
        'Content-Type': 'text/plain;charset=UTF-8',
        'next-action': actionID,
        'Referer': finalURL,
        'next-router-state-tree': routerStateTreeEncoded,
      }),
      body: payload,
    }, { timeout: DEFAULT_TIMEOUT, retries: 0 });

    if (!resp.ok) {
      throw new Error(`Final link request failed with status ${resp.status}`);
    }

    return resp.text();
  }

  /**
   * Get final link URL from response
   */
  async getFinalLink(actionID, eid) {
    const responseText = await this.getRawFinalLinkResponse(actionID, eid);

    // Try to parse last line as JSON array
    const lines = responseText.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed) && parsed.length > 1) {
          const linkObj = parsed[parsed.length - 1];
          if (linkObj && typeof linkObj === 'object' && linkObj.url) {
            return linkObj.url;
          }
          // Also try index 1
          if (parsed[1] && typeof parsed[1] === 'object' && parsed[1].url) {
            return parsed[1].url;
          }
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // Fallback: regex for URLs
    const urlMatch = responseText.match(/(https?:\/\/[^\s"'<>]+|magnet:\?[^\s"'<>]+)/);
    if (urlMatch) {
      return urlMatch[0];
    }

    return '';
  }

  /**
   * Validate credential_action_id
   */
  async validateCredentialID(actionID) {
    try {
      await this.getCredentials('test', actionID);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate intermediate_action_id
   */
  async validateIntermediateID(actionID, testHash, testSha) {
    try {
      await this.performIntermediateStep(actionID, testHash, testSha, 'fake_eid_for_validation');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate final_link_action_id
   */
  async validateFinalLinkID(actionID, testEID) {
    try {
      const responseText = await this.getRawFinalLinkResponse(actionID, testEID);
      const keywords = ['http', 'magnet', 'aliyundrive', '"url"'];
      for (const kw of keywords) {
        if (responseText.includes(kw)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Discover all three Action IDs through validation
   */
  async discoverActionIDs() {
    const potentialIDs = await this.findPotentialActionIDs();
    if (potentialIDs.length === 0) {
      throw new Error('No potential Action IDs found');
    }

    const finalIDs = {};

    // 1. Validate credential_action_id (concurrent)
    const credResults = await Promise.allSettled(
      potentialIDs.map(async (id) => {
        const valid = await this.validateCredentialID(id);
        if (valid) return id;
        throw new Error('invalid');
      })
    );

    let credentialID = null;
    for (const r of credResults) {
      if (r.status === 'fulfilled' && r.value) {
        credentialID = r.value;
        break;
      }
    }

    if (!credentialID) {
      throw new Error('Failed to validate credential_action_id');
    }
    finalIDs[ACTION_ID_KEYS[0]] = credentialID;

    // Get test credentials for further validation
    const testCreds = await this.getCredentials('test', credentialID);

    // Remaining IDs (exclude credential ID)
    let remainingIDs = potentialIDs.filter(id => id !== credentialID);

    // 2. Validate intermediate_action_id (iterate from end)
    let intermediateID = null;
    for (let i = remainingIDs.length - 1; i >= 0; i--) {
      const valid = await this.validateIntermediateID(
        remainingIDs[i], testCreds.hash, testCreds.sha
      );
      if (valid) {
        intermediateID = remainingIDs[i];
        break;
      }
    }

    if (!intermediateID) {
      throw new Error('Failed to validate intermediate_action_id');
    }
    finalIDs[ACTION_ID_KEYS[1]] = intermediateID;

    // Get test search results to get an EID for final link validation
    const { hits: testHits } = await this.getSearchResults(testCreds.sign, 1);
    if (testHits.length === 0) {
      throw new Error('No test search results for final link validation');
    }
    const testEID = testHits[0].eid;

    // Remaining IDs (exclude both credential and intermediate)
    remainingIDs = remainingIDs.filter(id => id !== intermediateID);

    // 3. Validate final_link_action_id
    let finalLinkID = null;
    for (const id of remainingIDs) {
      // Perform intermediate step first
      try {
        await this.performIntermediateStep(intermediateID, testCreds.hash, testCreds.sha, testEID);
      } catch {
        continue;
      }

      const valid = await this.validateFinalLinkID(id, testEID);
      if (valid) {
        finalLinkID = id;
        break;
      }
    }

    // If not found and we had exactly 3 IDs, try swapping intermediate and final_link
    if (!finalLinkID && remainingIDs.length === 1 && potentialIDs.length === 3) {
      const oldInterID = finalIDs[ACTION_ID_KEYS[1]];
      const candidateInterID = remainingIDs[0];

      // Try swap
      try {
        await this.performIntermediateStep(candidateInterID, testCreds.hash, testCreds.sha, testEID);
        const valid = await this.validateFinalLinkID(oldInterID, testEID);
        if (valid) {
          finalIDs[ACTION_ID_KEYS[1]] = candidateInterID;
          finalLinkID = oldInterID;
        }
      } catch {
        // Swap failed
      }
    }

    if (!finalLinkID) {
      throw new Error('Failed to validate final_link_action_id');
    }
    finalIDs[ACTION_ID_KEYS[2]] = finalLinkID;

    // Save to module cache
    actionIDCache = { ...finalIDs };

    return finalIDs;
  }

  /**
   * Main search method
   */
  async search(keyword, ext = {}) {
    // Step 1: Get or discover Action IDs
    let actionIDs;
    try {
      actionIDs = await this.getOrDiscoverActionIDs();
    } catch {
      return [];
    }

    // Step 2: Get search credentials
    let credentials;
    try {
      credentials = await this.getCredentials(keyword, actionIDs[ACTION_ID_KEYS[0]]);
    } catch {
      // Retry with fresh action IDs
      try {
        actionIDCache = {};
        actionIDs = await this.discoverActionIDs();
        credentials = await this.getCredentials(keyword, actionIDs[ACTION_ID_KEYS[0]]);
      } catch {
        return [];
      }
    }

    // Step 3: Get first page of search results
    let allHits = [];
    let maxPageNum = 0;
    try {
      const firstPage = await this.getSearchResults(credentials.sign, 1);
      allHits = firstPage.hits || [];
      maxPageNum = firstPage.maxPageNum || 0;
    } catch {
      return [];
    }

    if (allHits.length === 0) return [];

    // Fetch additional pages concurrently (up to MAX_PAGES)
    if (maxPageNum > 1) {
      const pagesToFetch = Math.min(maxPageNum, MAX_PAGES);
      const pagePromises = [];
      for (let page = 2; page <= pagesToFetch; page++) {
        pagePromises.push(
          this.getSearchResults(credentials.sign, page).catch(() => ({ hits: [] }))
        );
      }
      const additionalPages = await Promise.all(pagePromises);
      for (const page of additionalPages) {
        if (page.hits && page.hits.length > 0) {
          allHits = allHits.concat(page.hits);
        }
      }
    }

    // Step 4: For each hit, perform intermediate step then get final link (concurrent)
    const processResults = await Promise.allSettled(
      allHits.map(async (hit, index) => {
        const { eid, desc, size_str } = hit;
        if (!eid) return null;

        // Intermediate step
        try {
          await this.performIntermediateStep(
            actionIDs[ACTION_ID_KEYS[1]],
            credentials.hash,
            credentials.sha,
            eid
          );
        } catch {
          return null;
        }

        // Get final link
        let finalLink;
        try {
          finalLink = await this.getFinalLink(actionIDs[ACTION_ID_KEYS[2]], eid);
        } catch {
          return null;
        }

        if (!finalLink) return null;

        const linkType = determineLinkType(finalLink);
        const password = extractLinkPassword(finalLink, linkType);
        const title = extractTitle(desc);
        const cleanedDesc = cleanEscapedHTML(desc);

        return {
          uniqueId: generateUniqueID('panyq', eid),
          title: cleanEscapedHTML(title),
          content: cleanedDesc + (size_str ? ` [${size_str}]` : ''),
          links: [{
            type: linkType,
            url: finalLink,
            password,
          }],
          channel: '',
          datetime: '',
        };
      })
    );

    // Collect successful results
    const results = [];
    for (const r of processResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }

    return filterByKeyword(results, keyword);
  }
}

module.exports = PanyqPlugin;
