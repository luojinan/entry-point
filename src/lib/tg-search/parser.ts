import * as cheerio from "cheerio";
import {
  ALIYUN_PAN_PATTERN,
  ALL_PAN_LINKS_PATTERN,
  BAIDU_PAN_PATTERN,
  clean115PanUrl,
  clean123PanUrl,
  cleanAliyunPanUrl,
  cleanTianyiPanUrl,
  cleanUCPanUrl,
  extractNetDiskLinks,
  extractPassword,
  getLinkType,
  normalizeBaiduPanUrl,
  normalizeUrl,
  PAN_115_PATTERN,
  PAN_123_PATTERN,
  QUARK_PAN_PATTERN,
  TIANYI_PAN_PATTERN,
  UC_PAN_PATTERN,
  XUNLEI_PAN_PATTERN,
} from "./regex";
import type { Link, SearchResult } from "./types";

/** 检查链接是否为支持的网盘链接 */
function isSupportedLink(url: string): boolean {
  const lowerURL = url.toLowerCase();

  if (BAIDU_PAN_PATTERN.test(lowerURL)) return true;
  if (TIANYI_PAN_PATTERN.test(lowerURL)) return true;
  if (UC_PAN_PATTERN.test(lowerURL)) return true;
  if (PAN_123_PATTERN.test(lowerURL)) return true;
  if (QUARK_PAN_PATTERN.test(lowerURL)) return true;
  if (XUNLEI_PAN_PATTERN.test(lowerURL)) return true;
  if (PAN_115_PATTERN.test(lowerURL)) return true;
  if (ALIYUN_PAN_PATTERN.test(lowerURL)) return true;

  return ALL_PAN_LINKS_PATTERN.test(lowerURL);
}

/** 从CSS样式字符串中提取background-image的URL */
export function extractImageUrlFromStyle(style: string): string {
  // 查找background-image:url('...') 或 background-image:url("...")
  let startPattern = "background-image:url('";
  let endPattern = "')";

  let startIndex = style.indexOf(startPattern);
  if (startIndex !== -1) {
    startIndex += startPattern.length;
    const endIndex = style.indexOf(endPattern, startIndex);
    if (endIndex !== -1) {
      return style.substring(startIndex, endIndex);
    }
  }

  // 尝试双引号格式
  startPattern = 'background-image:url("';
  endPattern = '")';

  startIndex = style.indexOf(startPattern);
  if (startIndex !== -1) {
    startIndex += startPattern.length;
    const endIndex = style.indexOf(endPattern, startIndex);
    if (endIndex !== -1) {
      return style.substring(startIndex, endIndex);
    }
  }

  // 尝试无引号格式
  startPattern = "background-image:url(";
  endPattern = ")";

  startIndex = style.indexOf(startPattern);
  if (startIndex !== -1) {
    startIndex += startPattern.length;
    const endIndex = style.indexOf(endPattern, startIndex);
    if (endIndex !== -1) {
      let url = style.substring(startIndex, endIndex);
      // 移除可能的引号
      url = url.replace(/^['"]|['"]$/g, "");
      return url;
    }
  }

  return "";
}

/** 根据关键词进行裁剪，保留最前关键词前的部分 */
export function cutTitleByKeywords(title: string, keywords: string[]): string {
  let minIdx = -1;
  for (const kw of keywords) {
    const idx = title.indexOf(kw);
    if (idx >= 0 && (minIdx === -1 || idx < minIdx)) {
      minIdx = idx;
    }
  }
  if (minIdx > 0) {
    return title.substring(0, minIdx).trim();
  }
  return title.trim();
}

/** 从消息HTML和文本内容中提取标题 */
export function extractTitle(htmlContent: string, textContent: string): string {
  // 从HTML内容中提取标题
  const brIndex = htmlContent.indexOf("<br");
  if (brIndex > 0) {
    // 提取<br>前的HTML内容
    const firstLineHTML = htmlContent.substring(0, brIndex);

    // 使用cheerio解析这个HTML片段
    const $ = cheerio.load(`<div>${firstLineHTML}</div>`);
    const firstLine = $("div").text().trim();

    // 如果第一行以"名称："开头，则提取冒号后面的内容作为标题
    if (firstLine.startsWith("名称：")) {
      return firstLine.substring("名称：".length).trim();
    }

    // 如果第一行只是标签(以#开头)，尝试从第二行提取
    if (firstLine.startsWith("#") && !firstLine.includes("名称")) {
      // 继续从文本内容提取
    } else {
      return firstLine;
    }
  }

  // 如果HTML解析失败，则使用纯文本内容
  const lines = textContent.split("\n");
  if (lines.length === 0) {
    return "";
  }

  // 第一行通常是标题
  const firstLine = lines[0].trim();

  // 如果第一行只是标签(以#开头且不包含实际内容)，尝试从第二行或"名称："字段提取
  if (firstLine.startsWith("#")) {
    // 检查是否有"名称："字段
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("名称：")) {
        return trimmedLine.substring("名称：".length).trim();
      }
    }

    // 如果没有"名称："字段，尝试使用第二行
    if (lines.length > 1) {
      const secondLine = lines[1].trim();
      if (secondLine.startsWith("名称：")) {
        return secondLine.substring("名称：".length).trim();
      }
      // 如果第二行不是空的且不是标签，使用第二行
      if (secondLine && !secondLine.startsWith("#")) {
        return cutTitleByKeywords(secondLine, ["简介", "描述"]);
      }
    }
  }

  // 如果第一行以"名称："开头，则提取冒号后面的内容作为标题
  if (firstLine.startsWith("名称：")) {
    return firstLine.substring("名称：".length).trim();
  }

  // 否则直接使用第一行作为标题
  // 统一裁剪：遇到简介/描述等关键字时，只保留前半部分
  return cutTitleByKeywords(firstLine, ["简介", "描述"]);
}

/** 为每个链接提取作品标题 */
function extractWorkTitlesForLinks(
  links: Link[],
  _messageText: string,
  defaultTitle: string,
): Link[] {
  if (links.length === 0) {
    return links;
  }

  // 如果链接数量 <= 4，认为是同一个作品的不同网盘链接
  if (links.length <= 4) {
    return links.map((link) => ({
      ...link,
      work_title: defaultTitle,
    }));
  }

  // 如果链接数量 > 4，简化处理：使用默认标题
  // (完整的多作品标题提取逻辑较复杂，可后续优化)
  return links.map((link) => ({
    ...link,
    work_title: defaultTitle,
  }));
}

/** 解析搜索结果页面 */
export function parseSearchResults(
  html: string,
  channel: string,
): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  // 查找消息块
  $(".tgme_widget_message_wrap").each((_, wrapElem) => {
    const messageDiv = $(wrapElem).find(".tgme_widget_message");

    // 提取消息ID
    const dataPost = messageDiv.attr("data-post");
    if (!dataPost) return;

    const parts = dataPost.split("/");
    if (parts.length !== 2) return;

    const messageID = parts[1];

    // 生成全局唯一ID
    const uniqueID = `${channel}_${messageID}`;

    // 提取时间
    const timeStr = messageDiv
      .find(".tgme_widget_message_date time")
      .attr("datetime");
    if (!timeStr) return;

    // 获取消息文本元素
    const messageTextElem = messageDiv.find(".tgme_widget_message_text");

    // 获取消息文本的HTML内容
    const messageHTML = messageTextElem.html() || "";

    // 获取消息的纯文本内容
    const messageText = messageTextElem.text();

    // 提取标题
    const title = extractTitle(messageHTML, messageText);

    // 提取网盘链接 - 使用更精确的方法
    const links: Link[] = [];
    const foundLinks = new Set<string>(); // 用于去重
    const baiduLinkPasswords = new Map<string, string>(); // 存储百度链接和对应的密码
    const tianyiLinkPasswords = new Map<string, string>(); // 存储天翼链接和对应的密码
    const ucLinkPasswords = new Map<string, string>(); // 存储UC链接和对应的密码
    const pan123LinkPasswords = new Map<string, string>(); // 存储123网盘链接和对应的密码
    const pan115LinkPasswords = new Map<string, string>(); // 存储115网盘链接和对应的密码
    const aliyunLinkPasswords = new Map<string, string>(); // 存储阿里云盘链接和对应的密码

    // 1. 从文本内容中提取所有网盘链接和密码
    const extractedLinks = extractNetDiskLinks(messageText);

    // 2. 从a标签中提取链接
    messageTextElem.find("a").each((_, aElem) => {
      const href = $(aElem).attr("href");
      if (!href) return;

      // 使用更精确的方式匹配网盘链接
      if (isSupportedLink(href)) {
        const linkType = getLinkType(href);
        const password = extractPassword(messageText, href);

        // 如果是百度网盘链接，记录链接和密码的对应关系
        if (linkType === "baidu") {
          // 提取链接的基本部分（不含密码参数）
          let baseURL = href;
          if (href.includes("?pwd=")) {
            baseURL = href.substring(0, href.indexOf("?pwd="));
          }

          // 记录密码
          if (password) {
            baiduLinkPasswords.set(baseURL, password);
          }
        } else if (linkType === "tianyi") {
          const baseURL = cleanTianyiPanUrl(href);
          if (password) {
            tianyiLinkPasswords.set(baseURL, password);
          } else if (!tianyiLinkPasswords.has(baseURL)) {
            tianyiLinkPasswords.set(baseURL, "");
          }
        } else if (linkType === "uc") {
          const baseURL = cleanUCPanUrl(href);
          if (password) {
            ucLinkPasswords.set(baseURL, password);
          } else if (!ucLinkPasswords.has(baseURL)) {
            ucLinkPasswords.set(baseURL, "");
          }
        } else if (linkType === "123") {
          const baseURL = clean123PanUrl(href);
          if (password) {
            pan123LinkPasswords.set(baseURL, password);
          } else if (!pan123LinkPasswords.has(baseURL)) {
            pan123LinkPasswords.set(baseURL, "");
          }
        } else if (linkType === "115") {
          const baseURL = clean115PanUrl(href);
          if (password) {
            pan115LinkPasswords.set(baseURL, password);
          } else if (!pan115LinkPasswords.has(baseURL)) {
            pan115LinkPasswords.set(baseURL, "");
          }
        } else if (linkType === "aliyun") {
          const baseURL = cleanAliyunPanUrl(href);
          if (password) {
            aliyunLinkPasswords.set(baseURL, password);
          } else if (!aliyunLinkPasswords.has(baseURL)) {
            aliyunLinkPasswords.set(baseURL, "");
          }
        } else {
          // 非特殊处理的网盘链接直接添加
          const normalizedHref = normalizeUrl(href);
          if (!foundLinks.has(normalizedHref)) {
            foundLinks.add(normalizedHref);
            links.push({
              type: linkType,
              url: normalizedHref,
              password: password,
            });
          }
        }
      }
    });

    // 3. 处理从文本中提取的链接
    for (const linkURL of extractedLinks) {
      const linkType = getLinkType(linkURL);
      const password = extractPassword(messageText, linkURL);

      if (linkType === "baidu") {
        let baseURL = linkURL;
        if (linkURL.includes("?pwd=")) {
          baseURL = linkURL.substring(0, linkURL.indexOf("?pwd="));
        }
        if (password) {
          baiduLinkPasswords.set(baseURL, password);
        }
      } else if (linkType === "tianyi") {
        const baseURL = cleanTianyiPanUrl(linkURL);
        if (password) {
          tianyiLinkPasswords.set(baseURL, password);
        } else if (!tianyiLinkPasswords.has(baseURL)) {
          tianyiLinkPasswords.set(baseURL, "");
        }
      } else if (linkType === "uc") {
        const baseURL = cleanUCPanUrl(linkURL);
        if (password) {
          ucLinkPasswords.set(baseURL, password);
        } else if (!ucLinkPasswords.has(baseURL)) {
          ucLinkPasswords.set(baseURL, "");
        }
      } else if (linkType === "123") {
        const baseURL = clean123PanUrl(linkURL);
        if (password) {
          pan123LinkPasswords.set(baseURL, password);
        } else if (!pan123LinkPasswords.has(baseURL)) {
          pan123LinkPasswords.set(baseURL, "");
        }
      } else if (linkType === "115") {
        const baseURL = clean115PanUrl(linkURL);
        if (password) {
          pan115LinkPasswords.set(baseURL, password);
        } else if (!pan115LinkPasswords.has(baseURL)) {
          pan115LinkPasswords.set(baseURL, "");
        }
      } else if (linkType === "aliyun") {
        const baseURL = cleanAliyunPanUrl(linkURL);
        if (password) {
          aliyunLinkPasswords.set(baseURL, password);
        } else if (!aliyunLinkPasswords.has(baseURL)) {
          aliyunLinkPasswords.set(baseURL, "");
        }
      } else {
        const normalizedLinkURL = normalizeUrl(linkURL);
        if (!foundLinks.has(normalizedLinkURL)) {
          foundLinks.add(normalizedLinkURL);
          links.push({
            type: linkType,
            url: normalizedLinkURL,
            password: password,
          });
        }
      }
    }

    // 4. 处理百度网盘链接，确保每个链接只有一个版本（带密码的完整版本）
    for (const [baseURL, password] of baiduLinkPasswords.entries()) {
      const normalizedURL = normalizeBaiduPanUrl(baseURL, password);
      if (!foundLinks.has(normalizedURL)) {
        foundLinks.add(normalizedURL);
        links.push({
          type: "baidu",
          url: normalizedURL,
          password: password,
        });
      }
    }

    // 5. 处理天翼云盘链接
    for (const [baseURL, password] of tianyiLinkPasswords.entries()) {
      const normalizedURL = cleanTianyiPanUrl(baseURL);
      if (!foundLinks.has(normalizedURL)) {
        foundLinks.add(normalizedURL);
        links.push({
          type: "tianyi",
          url: normalizedURL,
          password: password,
        });
      }
    }

    // 6. 处理UC网盘链接
    for (const [baseURL, password] of ucLinkPasswords.entries()) {
      const normalizedURL = cleanUCPanUrl(baseURL);
      if (!foundLinks.has(normalizedURL)) {
        foundLinks.add(normalizedURL);
        links.push({
          type: "uc",
          url: normalizedURL,
          password: password,
        });
      }
    }

    // 7. 处理123网盘链接
    for (const [baseURL, password] of pan123LinkPasswords.entries()) {
      const normalizedURL = clean123PanUrl(baseURL);
      if (!foundLinks.has(normalizedURL)) {
        foundLinks.add(normalizedURL);
        links.push({
          type: "123",
          url: normalizedURL,
          password: password,
        });
      }
    }

    // 8. 处理115网盘链接
    for (const [baseURL, password] of pan115LinkPasswords.entries()) {
      const normalizedURL = clean115PanUrl(baseURL);
      if (!foundLinks.has(normalizedURL)) {
        foundLinks.add(normalizedURL);
        links.push({
          type: "115",
          url: normalizedURL,
          password: password,
        });
      }
    }

    // 9. 处理阿里云盘链接
    for (const [baseURL, password] of aliyunLinkPasswords.entries()) {
      const normalizedURL = cleanAliyunPanUrl(baseURL);
      if (!foundLinks.has(normalizedURL)) {
        foundLinks.add(normalizedURL);
        links.push({
          type: "aliyun",
          url: normalizedURL,
          password: password,
        });
      }
    }

    // 提取标签
    const tags: string[] = [];
    messageTextElem.find("a[href^='?q=%23']").each((_, aElem) => {
      const tag = $(aElem).text();
      if (tag.startsWith("#")) {
        tags.push(tag.substring(1));
      }
    });

    // 提取图片链接（只从消息内容区域提取，排除用户头像）
    const images: string[] = [];
    const foundImages = new Set<string>(); // 用于去重

    // 获取消息气泡区域，排除用户头像区域
    const messageBubble = messageDiv.find(".tgme_widget_message_bubble");

    // 1. 从消息内容中的图片包装元素提取图片
    messageBubble
      .find(".tgme_widget_message_photo_wrap")
      .each((_, photoWrap) => {
        const style = $(photoWrap).attr("style");
        if (style) {
          const imageURL = extractImageUrlFromStyle(style);
          if (imageURL && !foundImages.has(imageURL)) {
            foundImages.add(imageURL);
            images.push(imageURL);
          }
        }
      });

    // 2. 从消息内容中的其他可能包含图片的元素提取（排除用户头像）
    messageBubble.find("img").each((_, imgElem) => {
      const src = $(imgElem).attr("src");
      if (src && !foundImages.has(src)) {
        foundImages.add(src);
        images.push(src);
      }
    });

    // 只有包含链接的消息才添加到结果中
    if (links.length > 0) {
      // 为每个链接提取作品标题
      const linksWithTitles = extractWorkTitlesForLinks(
        links,
        messageText,
        title,
      );

      results.push({
        message_id: messageID,
        unique_id: uniqueID,
        channel: channel,
        datetime: timeStr,
        title: title,
        content: messageText,
        links: linksWithTitles,
        tags: tags.length > 0 ? tags : undefined,
        images: images.length > 0 ? images : undefined,
      });
    }
  });

  return results;
}
