/** 支持的网盘链接类型 */
export type LinkType =
  | "baidu"
  | "quark"
  | "aliyun"
  | "tianyi"
  | "uc"
  | "mobile"
  | "115"
  | "pikpak"
  | "xunlei"
  | "123"
  | "magnet"
  | "ed2k"
  | "others";

/** 从 TG 消息中提取的单个网盘链接 */
export interface Link {
  type: LinkType;
  url: string;
  password: string;
  datetime?: string; // ISO 8601 字符串
  work_title?: string; // 此链接所属的具体作品标题
}

/** 包含网盘链接的已解析 TG 消息 */
export interface SearchResult {
  message_id: string;
  unique_id: string;
  channel: string;
  datetime: string; // ISO 8601 字符串
  title: string;
  content: string;
  links: Link[];
  tags?: string[];
  images?: string[]; // TG 消息中的图片链接
}

/** 按网盘类型分组的合并链接 */
export interface MergedLink {
  url: string;
  password: string;
  note: string;
  datetime: string;
  source?: string; // 数据来源: tg:频道名 或 plugin:插件名
  images?: string[];
}

/** 按网盘类型分组的链接 */
export type MergedLinks = Record<string, MergedLink[]>;

/** API 响应格式 */
export interface SearchResponse {
  total: number;
  results?: SearchResult[];
  merged_by_type?: MergedLinks;
}

/** API 请求参数 */
export interface SearchRequest {
  keyword: string;
  channels?: string[];
  result_type?: "results" | "merged_by_type" | "all";
}
