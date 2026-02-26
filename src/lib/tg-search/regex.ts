import type { LinkType } from "./types";

// 通用网盘链接匹配正则表达式
export const ALL_PAN_LINKS_PATTERN =
  /(?:magnet:\?xt=urn:btih:[a-zA-Z0-9]+)|(?:ed2k:\/\/\|file\|[^|]+\|\d+\|[A-Fa-f0-9]+\|\/?)|(?:https?:\/\/(?:(?:[\w.-]+\.)?(?:pan\.(?:baidu|quark)\.cn|(?:www\.)?(?:alipan|aliyundrive)\.com|drive\.uc\.cn|cloud\.189\.cn|caiyun\.139\.com|(?:www\.)?123(?:684|685|912|pan|592)\.(?:com|cn)|115\.com|115cdn\.com|anxia\.com|pan\.xunlei\.com|mypikpak\.com))(?:\/[^\s'"<>()]*)?)/gi;

// 各种网盘的链接匹配模式
export const BAIDU_PAN_PATTERN =
  /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]{4})?/gi;
export const QUARK_PAN_PATTERN = /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/gi;
export const XUNLEI_PAN_PATTERN =
  /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9]+(?:\?pwd=[a-zA-Z0-9]{4})?(?:#)?/gi;
export const TIANYI_PAN_PATTERN =
  /https?:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+(?:%[0-9A-Fa-f]{2})*(?:（[^）]*）)?/gi;
export const UC_PAN_PATTERN =
  /https?:\/\/drive\.uc\.cn\/s\/[a-zA-Z0-9]+(?:\?public=\d)?/gi;
export const PAN_123_PATTERN =
  /https?:\/\/(?:www\.)?123(?:684|865|685|912|pan|592)\.(?:com|cn)\/s\/[a-zA-Z0-9_-]+(?:\?(?:%E6%8F%90%E5%8F%96%E7%A0%81|提取码)[:：][a-zA-Z0-9]+)?/gi;
export const PAN_115_PATTERN =
  /https?:\/\/(?:115\.com|115cdn\.com|anxia\.com)\/s\/[a-zA-Z0-9]+(?:\?password=[a-zA-Z0-9]{4})?(?:#)?/gi;
export const ALIYUN_PAN_PATTERN =
  /https?:\/\/(?:www\.)?(?:alipan|aliyundrive)\.com\/s\/[a-zA-Z0-9]+/gi;

// 提取码匹配正则表达式
export const PASSWORD_PATTERN =
  /(?:(?:提取|访问|提取密|密)码|pwd)[：:]\s*([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)/i;
export const URL_PASSWORD_PATTERN =
  /[?&]pwd=([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)/i;
export const BAIDU_PASSWORD_PATTERN =
  /(?:链接：.*?提取码：|密码：|提取码：|pwd=|pwd:|pwd：)([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)/i;

/** 获取链接类型 */
export function getLinkType(url: string): LinkType {
  const lowerUrl = url.toLowerCase();

  // 处理可能带有"链接："前缀的情况
  let cleanUrl = lowerUrl;
  if (lowerUrl.includes("链接：") || lowerUrl.includes("链接:")) {
    const parts = lowerUrl.split("链接");
    if (parts.length > 1) {
      cleanUrl = parts[1].replace(/^[：:]/, "").trim();
    }
  }

  if (cleanUrl.includes("ed2k:")) return "ed2k";
  if (cleanUrl.startsWith("magnet:")) return "magnet";
  if (cleanUrl.includes("pan.baidu.com")) return "baidu";
  if (cleanUrl.includes("pan.quark.cn")) return "quark";
  if (cleanUrl.includes("alipan.com") || cleanUrl.includes("aliyundrive.com"))
    return "aliyun";
  if (cleanUrl.includes("cloud.189.cn")) return "tianyi";
  if (cleanUrl.includes("drive.uc.cn")) return "uc";
  if (cleanUrl.includes("caiyun.139.com")) return "mobile";
  if (
    cleanUrl.includes("115.com") ||
    cleanUrl.includes("115cdn.com") ||
    cleanUrl.includes("anxia.com")
  )
    return "115";
  if (cleanUrl.includes("mypikpak.com")) return "pikpak";
  if (cleanUrl.includes("pan.xunlei.com")) return "xunlei";

  // 123网盘有多个域名
  if (
    cleanUrl.includes("123684.com") ||
    cleanUrl.includes("123685.com") ||
    cleanUrl.includes("123865.com") ||
    cleanUrl.includes("123912.com") ||
    cleanUrl.includes("123pan.com") ||
    cleanUrl.includes("123pan.cn") ||
    cleanUrl.includes("123592.com")
  ) {
    return "123";
  }

  return "others";
}

/** 标准化URL，将URL编码的中文部分解码为中文，用于去重 */
export function normalizeUrl(rawUrl: string): string {
  try {
    return decodeURIComponent(rawUrl);
  } catch {
    return rawUrl;
  }
}

/** 检查提取码是否有效（只包含字母和数字） */
export function isValidPassword(password: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(password);
}

/** 清理百度网盘URL */
export function cleanBaiduPanUrl(url: string): string {
  if (!url.includes("https://pan.baidu.com/s/")) return url;

  const startIdx = url.indexOf("https://pan.baidu.com/s/");
  if (startIdx < 0) return url;

  url = url.substring(startIdx);

  // 查找可能的结束标记
  const endMarkers = [" ", "\n", "\t", "，", "。", "；", ";", ","];
  let minEndIdx = url.length;

  for (const marker of endMarkers) {
    const idx = url.indexOf(marker);
    if (idx > 0 && idx < minEndIdx) {
      minEndIdx = idx;
    }
  }

  if (minEndIdx < url.length) {
    url = url.substring(0, minEndIdx);
  }

  // 特殊处理pwd参数
  if (url.includes("?pwd=")) {
    const pwdIdx = url.indexOf("?pwd=");
    if (pwdIdx >= 0 && url.length > pwdIdx + 5) {
      const pwdEndIdx = pwdIdx + 9; // ?pwd=xxxx 总共9个字符
      if (pwdEndIdx <= url.length) {
        return url.substring(0, pwdEndIdx);
      }
    }
  }

  return url;
}

/** 清理天翼云盘URL */
export function cleanTianyiPanUrl(url: string): string {
  if (!url.includes("https://cloud.189.cn/t/")) return url;

  const startIdx = url.indexOf("https://cloud.189.cn/t/");
  if (startIdx < 0) return url;

  url = url.substring(startIdx);

  const endMarkers = [
    " ",
    "\n",
    "\t",
    "，",
    "。",
    "；",
    ";",
    ",",
    "实时",
    "天翼",
    "更多",
  ];
  let minEndIdx = url.length;

  for (const marker of endMarkers) {
    const idx = url.indexOf(marker);
    if (idx > 0 && idx < minEndIdx) {
      minEndIdx = idx;
    }
  }

  if (minEndIdx < url.length) {
    url = url.substring(0, minEndIdx);
  }

  return normalizeUrl(url);
}

/** 清理UC网盘URL */
export function cleanUCPanUrl(url: string): string {
  if (!url.includes("https://drive.uc.cn/s/")) return url;

  const startIdx = url.indexOf("https://drive.uc.cn/s/");
  if (startIdx < 0) return url;

  url = url.substring(startIdx);

  const endMarkers = [
    " ",
    "\n",
    "\t",
    "，",
    "。",
    "；",
    ";",
    ",",
    "网盘",
    "123",
    "夸克",
    "阿里",
    "百度",
  ];
  let minEndIdx = url.length;

  for (const marker of endMarkers) {
    const idx = url.indexOf(marker);
    if (idx > 0 && idx < minEndIdx) {
      minEndIdx = idx;
    }
  }

  if (minEndIdx < url.length) {
    return url.substring(0, minEndIdx);
  }

  if (url.includes("?public=")) {
    const publicIdx = url.indexOf("?public=");
    if (publicIdx > 0 && publicIdx + 9 <= url.length) {
      return url.substring(0, publicIdx + 9);
    }
  }

  return url;
}

/** 清理123网盘URL */
export function clean123PanUrl(url: string): string {
  const domains = [
    "123684.com",
    "123685.com",
    "123865.com",
    "123912.com",
    "123pan.com",
    "123pan.cn",
    "123592.com",
  ];

  let isDomain123 = false;
  for (const domain of domains) {
    if (url.includes(`${domain}/s/`)) {
      isDomain123 = true;
      break;
    }
  }

  if (!isDomain123) return url;

  const hasProtocol = url.startsWith("http://") || url.startsWith("https://");

  let startIdx = -1;
  for (const domain of domains) {
    const idx = url.indexOf(`${domain}/s/`);
    if (idx >= 0) {
      startIdx = idx;
      break;
    }
  }

  if (startIdx < 0) return url;

  if (!hasProtocol) {
    url = `https://${url.substring(startIdx)}`;
  } else if (startIdx > 0) {
    const protocolIdx = url.indexOf("://");
    if (protocolIdx >= 0) {
      const protocol = url.substring(0, protocolIdx + 3);
      url = protocol + url.substring(startIdx);
    }
  }

  const endMarkers = [
    " ",
    "\n",
    "\t",
    "，",
    "。",
    "；",
    ";",
    ",",
    "📁",
    "🔍",
    "标签",
  ];
  let minEndIdx = url.length;

  for (const marker of endMarkers) {
    const idx = url.indexOf(marker);
    if (idx > 0 && idx < minEndIdx) {
      minEndIdx = idx;
    }
  }

  if (minEndIdx < url.length) {
    url = url.substring(0, minEndIdx);
  }

  // 标准化URL编码的提取码
  if (url.includes("%E6%8F%90%E5%8F%96%E7%A0%81")) {
    url = url.replace("%E6%8F%90%E5%8F%96%E7%A0%81", "提取码");
  }

  return url;
}

/** 清理115网盘URL */
export function clean115PanUrl(url: string): string {
  if (
    !url.includes("115.com/s/") &&
    !url.includes("115cdn.com/s/") &&
    !url.includes("anxia.com/s/")
  ) {
    return url;
  }

  let startIdx = -1;
  if (url.includes("115.com/s/")) {
    startIdx = url.indexOf("115.com/s/");
  } else if (url.includes("115cdn.com/s/")) {
    startIdx = url.indexOf("115cdn.com/s/");
  } else if (url.includes("anxia.com/s/")) {
    startIdx = url.indexOf("anxia.com/s/");
  }

  if (startIdx < 0) return url;

  const hasProtocol = url.startsWith("http://") || url.startsWith("https://");

  if (!hasProtocol) {
    url = `https://${url.substring(startIdx)}`;
  } else if (startIdx > 0) {
    const protocolIdx = url.indexOf("://");
    if (protocolIdx >= 0) {
      const protocol = url.substring(0, protocolIdx + 3);
      url = protocol + url.substring(startIdx);
    }
  }

  if (url.includes("?password=")) {
    const pwdIdx = url.indexOf("?password=");
    if (pwdIdx > 0 && pwdIdx + 14 <= url.length) {
      return url.substring(0, pwdIdx + 14);
    }
  }

  const hashIdx = url.indexOf("#");
  if (hashIdx > 0) {
    return url.substring(0, hashIdx);
  }

  return url;
}

/** 清理阿里云盘URL */
export function cleanAliyunPanUrl(url: string): string {
  if (!url.includes("alipan.com/s/") && !url.includes("aliyundrive.com/s/")) {
    return url;
  }

  let startIdx = -1;
  if (url.includes("www.alipan.com/s/")) {
    startIdx = url.indexOf("www.alipan.com/s/");
  } else if (url.includes("alipan.com/s/")) {
    startIdx = url.indexOf("alipan.com/s/");
  } else if (url.includes("www.aliyundrive.com/s/")) {
    startIdx = url.indexOf("www.aliyundrive.com/s/");
  } else if (url.includes("aliyundrive.com/s/")) {
    startIdx = url.indexOf("aliyundrive.com/s/");
  }

  if (startIdx < 0) return url;

  const hasProtocol = url.startsWith("http://") || url.startsWith("https://");

  if (!hasProtocol) {
    url = `https://${url.substring(startIdx)}`;
  } else if (startIdx > 0) {
    const protocolIdx = url.indexOf("://");
    if (protocolIdx >= 0) {
      const protocol = url.substring(0, protocolIdx + 3);
      url = protocol + url.substring(startIdx);
    }
  }

  const endMarkers = [
    " ",
    "\n",
    "\t",
    "，",
    "。",
    "；",
    ";",
    ",",
    "📁",
    "🔍",
    "标签",
  ];
  let minEndIdx = url.length;

  for (const marker of endMarkers) {
    const idx = url.indexOf(marker);
    if (idx > 0 && idx < minEndIdx) {
      minEndIdx = idx;
    }
  }

  if (minEndIdx < url.length) {
    return url.substring(0, minEndIdx);
  }

  return url;
}

/** 标准化百度网盘URL */
export function normalizeBaiduPanUrl(url: string, password: string): string {
  url = cleanBaiduPanUrl(url);

  if (url.includes("?pwd=")) return url;

  if (password && password.length >= 4) {
    const pwd = password.substring(0, 4);
    return `${url}?pwd=${pwd}`;
  }

  return url;
}

/** 提取链接密码 */
export function extractPassword(content: string, url: string): string {
  // 特殊处理天翼云盘URL中的访问码
  if (url.includes("cloud.189.cn")) {
    const tianyiMatch = url.match(
      /(?:（访问码：|%EF%BC%88%E8%AE%BF%E9%97%AE%E7%A0%81%EF%BC%9A)([a-zA-Z0-9]+)(?:）|%EF%BC%89)/,
    );
    if (tianyiMatch) return tianyiMatch[1];
  }

  // 特殊处理迅雷网盘URL中的pwd参数
  if (url.includes("pan.xunlei.com") && url.includes("?pwd=")) {
    const pwdMatch = url.match(/\?pwd=([a-zA-Z0-9]{4})/);
    if (pwdMatch) return pwdMatch[1];
  }

  // 先从URL中提取密码
  const urlMatch = URL_PASSWORD_PATTERN.exec(url);
  if (urlMatch) return urlMatch[1];

  // 特殊处理115网盘URL中的密码
  if (
    (url.includes("115.com") ||
      url.includes("115cdn.com") ||
      url.includes("anxia.com")) &&
    url.includes("password=")
  ) {
    const passwordMatch = url.match(/password=([a-zA-Z0-9]{4})/);
    if (passwordMatch) return passwordMatch[1];
  }

  // 特殊处理123网盘URL中的提取码
  if (
    (url.includes("123684.com") ||
      url.includes("123685.com") ||
      url.includes("123865.com") ||
      url.includes("123912.com") ||
      url.includes("123pan.com") ||
      url.includes("123pan.cn") ||
      url.includes("123592.com")) &&
    (url.includes("提取码") || url.includes("%E6%8F%90%E5%8F%96%E7%A0%81"))
  ) {
    const extractMatch = url.match(
      /(?:提取码|%E6%8F%90%E5%8F%96%E7%A0%81)[:：]([a-zA-Z0-9]+)/,
    );
    if (extractMatch) return extractMatch[1];
  }

  // 从内容中提取"提取码"
  if (content.includes("提取码")) {
    const parts = content.split("提取码");
    for (const part of parts) {
      const colonIdx = part.search(/[:：]/);
      if (colonIdx >= 0 && colonIdx + 1 < part.length) {
        let code = part.substring(colonIdx + 1).trim();
        const endIdx = code.search(/[\s\t\n\r，。；;,]/);
        if (endIdx > 0) {
          code = code.substring(0, endIdx);
        } else if (code.length > 6) {
          code = code.substring(0, 4);
        }
        code = code.trim();
        if (code && code.length <= 6 && isValidPassword(code)) {
          return code;
        }
      }
    }
  }

  // 对于百度网盘链接，尝试查找特定格式的密码
  if (url.toLowerCase().includes("pan.baidu.com")) {
    const baiduMatch = BAIDU_PASSWORD_PATTERN.exec(content);
    if (baiduMatch) return baiduMatch[1];
  }

  // 通用密码提取
  const passwordMatch = PASSWORD_PATTERN.exec(content);
  if (passwordMatch) return passwordMatch[1];

  return "";
}

/** 从文本中提取所有网盘链接 */
export function extractNetDiskLinks(text: string): string[] {
  const links: string[] = [];
  const foundLinks = new Set<string>();

  // 提取百度网盘链接
  const baiduMatches = Array.from(
    text.matchAll(BAIDU_PAN_PATTERN),
    (m) => m[0],
  );
  for (let match of baiduMatches) {
    match = cleanBaiduPanUrl(match);
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(match)) {
      foundLinks.add(match);
      links.push(match);
    }
  }

  // 提取天翼云盘链接
  const tianyiMatches = Array.from(
    text.matchAll(TIANYI_PAN_PATTERN),
    (m) => m[0],
  );
  for (let match of tianyiMatches) {
    match = cleanTianyiPanUrl(match);
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(match)) {
      foundLinks.add(match);
      links.push(match);
    }
  }

  // 提取UC网盘链接
  const ucMatches = Array.from(text.matchAll(UC_PAN_PATTERN), (m) => m[0]);
  for (let match of ucMatches) {
    match = cleanUCPanUrl(match);
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(match)) {
      foundLinks.add(match);
      links.push(match);
    }
  }

  // 提取123网盘链接
  const pan123Matches = Array.from(text.matchAll(PAN_123_PATTERN), (m) => m[0]);
  for (let match of pan123Matches) {
    match = clean123PanUrl(match);
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(normalizeUrl(match))) {
      foundLinks.add(normalizeUrl(match));
      links.push(match);
    }
  }

  // 提取115网盘链接
  const pan115Matches = Array.from(text.matchAll(PAN_115_PATTERN), (m) => m[0]);
  for (let match of pan115Matches) {
    match = clean115PanUrl(match);
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(normalizeUrl(match))) {
      foundLinks.add(normalizeUrl(match));
      links.push(match);
    }
  }

  // 提取阿里云盘链接
  const aliyunMatches = Array.from(
    text.matchAll(ALIYUN_PAN_PATTERN),
    (m) => m[0],
  );
  for (let match of aliyunMatches) {
    match = cleanAliyunPanUrl(match);
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(normalizeUrl(match))) {
      foundLinks.add(normalizeUrl(match));
      links.push(match);
    }
  }

  // 提取夸克网盘链接
  const quarkMatches = Array.from(
    text.matchAll(QUARK_PAN_PATTERN),
    (m) => m[0],
  );
  for (let match of quarkMatches) {
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(match)) {
      foundLinks.add(match);
      links.push(match);
    }
  }

  // 提取迅雷网盘链接
  const xunleiMatches = Array.from(
    text.matchAll(XUNLEI_PAN_PATTERN),
    (m) => m[0],
  );
  for (let match of xunleiMatches) {
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);
    if (match && !foundLinks.has(match)) {
      foundLinks.add(match);
      links.push(match);
    }
  }

  // 使用通用模式提取其他可能的链接
  const otherMatches = Array.from(
    text.matchAll(ALL_PAN_LINKS_PATTERN),
    (m) => m[0],
  );
  for (let match of otherMatches) {
    if (match.endsWith("https")) match = match.substring(0, match.length - 5);

    // 跳过已经处理过的链接
    if (
      match.includes("pan.baidu.com") ||
      match.includes("pan.quark.cn") ||
      match.includes("pan.xunlei.com") ||
      match.includes("cloud.189.cn") ||
      match.includes("drive.uc.cn") ||
      match.includes("123684.com") ||
      match.includes("123685.com") ||
      match.includes("123865.com") ||
      match.includes("123912.com") ||
      match.includes("123pan.com") ||
      match.includes("123pan.cn") ||
      match.includes("123592.com")
    ) {
      continue;
    }

    const normalized = normalizeUrl(match);
    if (match && !foundLinks.has(normalized)) {
      foundLinks.add(normalized);
      links.push(match);
    }
  }

  return links;
}
