import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MergedLink, SearchResponse } from "@/lib/tg-search/types";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  quark: "夸克",
  aliyun: "阿里云盘",
  baidu: "百度网盘",
  uc: "UC网盘",
  tianyi: "天翼云盘",
  mobile: "移动云盘",
  "115": "115网盘",
  pikpak: "PikPak",
  xunlei: "迅雷",
  "123": "123云盘",
  magnet: "磁力",
  ed2k: "电驴",
  others: "其他",
};

function getTypeLabel(type: string) {
  return TYPE_LABELS[type] ?? type;
}

function formatDate(datetime: string) {
  try {
    return new Date(datetime).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return datetime;
  }
}

function LinkItem({ link }: { link: MergedLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{link.note}</div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span>{formatDate(link.datetime)}</span>
          {link.password && (
            <span className="text-amber-600 dark:text-amber-400">
              密码: {link.password}
            </span>
          )}
        </div>
      </div>
      <svg
        className="text-muted-foreground size-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
        />
      </svg>
    </a>
  );
}

export function TGSearchResultCard({ output }: { output: unknown }) {
  const data = output as SearchResponse | null;

  const mergedByType = data?.merged_by_type;
  if (!mergedByType || Object.keys(mergedByType).length === 0) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>TG 资源搜索</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">未找到相关资源</p>
        </CardContent>
      </Card>
    );
  }

  const types = Object.keys(mergedByType);

  return (
    <TGSearchTabs
      types={types}
      mergedByType={mergedByType}
      total={data?.total ?? 0}
    />
  );
}

function TGSearchTabs({
  types,
  mergedByType,
  total,
}: {
  types: string[];
  mergedByType: Record<string, MergedLink[]>;
  total: number;
}) {
  const [activeTab, setActiveTab] = useState(types[0]);
  const links = mergedByType[activeTab] ?? [];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          TG 资源搜索
          <Badge variant="secondary">{total} 条结果</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Tabs */}
        <div className="flex flex-wrap gap-1">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setActiveTab(type);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                activeTab === type
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {getTypeLabel(type)}
              <span className="ml-1 opacity-60">
                {mergedByType[type].length}
              </span>
            </button>
          ))}
        </div>

        {/* Link list */}
        <div className="max-h-60 divide-y overflow-y-auto">
          {links.map((link) => (
            <LinkItem key={link.url} link={link} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
