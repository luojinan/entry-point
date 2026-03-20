export type CloudType =
  | "quark"
  | "uc"
  | "baidu"
  | "aliyun"
  | "xunlei"
  | "tianyi"
  | "115"
  | "123"
  | "pikpak"
  | "mobile"
  | "others";

export interface Link {
  type: CloudType;
  url: string;
  password: string;
}

export interface SearchResult {
  uniqueId: string;
  title: string;
  content: string;
  links: Link[];
  datetime: string;
  tags: string[];
  channel?: string;
}

export interface BasePluginInterface {
  name: string;
  priority: number;
  search(
    keyword: string,
    ext?: Record<string, unknown>,
  ): Promise<SearchResult[]>;
}

export type SearchPluginClass = new () => BasePluginInterface;
