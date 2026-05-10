import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parse, isValid } from "date-fns";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FundInfo } from "@/routes/api/qieman/-type";

export const Route = createFileRoute("/qieman/long-win-plan")({
  component: LongWinPlanPage,
});

type Composition = FundInfo["composition"][number];
type CompItem = Composition["compList"][number];
type ClearedFund = {
  className: string;
  item: CompItem;
  key: string;
};

function formatPercent(value: number | null, fallback = "-"): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatNavDate(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "string") {
    const matched = value.match(/(\d{1,4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (matched) {
      const [, year, month, day] = matched;
      const date = parse(`${year}-${month}-${day}`, "yyyy-M-d", new Date());
      return isValid(date) ? format(date, "MM-dd") : "-";
    }

    const parsed = new Date(value);
    if (isValid(parsed)) {
      return format(parsed, "MM-dd");
    }

    return value;
  }

  const date = new Date(value);
  if (!isValid(date)) {
    return "-";
  }

  return format(date, "MM-dd");
}

function DailyReturnCell({ value }: { value: number }) {
  const percent = (value * 100).toFixed(2);
  const color =
    value > 0
      ? "text-red-500"
      : value < 0
        ? "text-green-500"
        : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`font-medium ${color}`}>
      {sign}
      {percent}%
    </span>
  );
}

function CompItemRow({ item, detail }: { item: CompItem; detail?: string }) {
  const fund = item.fund;
  const unitValue =
    item.unitValue != null ? (item.unitValue * 100).toFixed(2) : "-";
  const accProfit = formatPercent(item.accProfit);
  const dailyReturn = item.dailyReturn;

  const navDisplay =
    fund?.nav ?? (item.nav != null ? item.nav.toFixed(4) : "-");
  const navDateDisplay = formatNavDate(fund?.navDate ?? item.navDate);

  return (
    <div className="grid grid-cols-11 items-center gap-2 border-b py-2 text-xs last:border-0 hover:bg-muted/30 px-2 rounded">
      <div className="col-span-3 min-w-0">
        <div className="truncate font-medium text-foreground">
          {item.variety}
        </div>
        {(fund?.fundCode || detail) && (
          <div className="truncate text-muted-foreground">
            {[fund?.fundCode, detail].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className="col-span-2 text-right">
        <div className="font-medium">{item.planUnit}份</div>
        <div className="text-muted-foreground">{unitValue}%</div>
      </div>
      <div className="col-span-2 text-right">
        <div className="font-medium">{navDisplay}</div>
        <div className="text-muted-foreground text-[10px]">
          {navDateDisplay}
        </div>
      </div>
      <div className="col-span-2 text-right">
        {dailyReturn != null ? (
          <DailyReturnCell value={dailyReturn} />
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>
      <div className="col-span-2 text-right">
        <span
          className={
            item.accProfit > 0
              ? "text-red-500"
              : item.accProfit < 0
                ? "text-green-500"
                : ""
          }
        >
          {accProfit}
        </span>
      </div>
    </div>
  );
}

function ClassSection({
  composition,
  items,
  isCollapsed,
  onToggle,
}: {
  composition: Composition;
  items: CompItem[];
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const accProfitRate = formatPercent(composition.accProfitRate);
  const percent = formatPercent(composition.percent);
  const isPositive = composition.accProfitRate > 0;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        className={cn(
          "flex w-full items-center justify-between bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50",
          !isCollapsed && "border-b",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "inline-block text-xs text-muted-foreground transition-transform",
              !isCollapsed && "rotate-90",
            )}
          >
            ▸
          </span>
          <span className="font-medium">{composition.className}</span>
          <Badge variant="outline" className="text-xs">
            {composition.unit}份
          </Badge>
          <span className="text-muted-foreground text-xs">{percent}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">累计收益</span>
          <span
            className={`font-medium ${isPositive ? "text-red-500" : "text-green-500"}`}
          >
            {accProfitRate}
          </span>
        </div>
      </button>
      {!isCollapsed && (
        <div className="divide-y">
          {items.length > 0 ? (
            items.map((item, idx) => {
              const key = item.fund?.fundCode ?? `${item.variety}-${idx}`;
              return <CompItemRow key={key} item={item} />;
            })
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              当前大类暂无持仓基金
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ data }: { data: FundInfo }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">已投份数</div>
          <div className="mt-1 text-xl font-semibold">{data.investedUnit}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">组合日涨跌</div>
          <div className="mt-1">
            <DailyReturnCell value={data.dailyReturn} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">年化复合收益率</div>
          <div
            className={`mt-1 text-xl font-semibold ${data.annualCompoundedReturn > 0 ? "text-red-500" : "text-green-500"}`}
          >
            {formatPercent(data.annualCompoundedReturn)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">成立以来收益率</div>
          <div
            className={`mt-1 text-xl font-semibold ${data.fromSetupReturn > 0 ? "text-red-500" : "text-green-500"}`}
          >
            {formatPercent(data.fromSetupReturn)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">夏普比率</div>
          <div className="mt-1 text-xl font-semibold">
            {data.sharpe.toFixed(2)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">最大回撤</div>
          <div className="mt-1 text-xl font-semibold text-green-500">
            {formatPercent(data.maxDrawdown)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LongWinPlanPage() {
  const [collapsedClasses, setCollapsedClasses] = useState<
    Record<string, boolean>
  >({});
  const [showClearedFunds, setShowClearedFunds] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["qieman", "long-win-plan"],
    queryFn: async (): Promise<FundInfo> => {
      const res = await fetch("/api/qieman/long-win-plan?prodCode=LONG_WIN");
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`);
      }
      const json = await res.json();
      return json.data as FundInfo;
    },
  });

  const classSections = data
    ? data.composition
        .filter((comp) => !comp.isCash && comp.className !== "现金")
        .map((comp, idx) => {
          const key = comp.classCode || `class-${idx}`;
          const items = comp.compList.filter(
            (item) =>
              !item.isCash && item.variety !== "现金" && item.planUnit > 0,
          );

          return {
            composition: comp,
            items,
            key,
          };
        })
    : [];

  const clearedFunds: ClearedFund[] = data
    ? data.composition
        .filter((comp) => !comp.isCash && comp.className !== "现金")
        .flatMap((comp, compIdx) =>
          comp.compList
            .filter(
              (item) =>
                !item.isCash && item.variety !== "现金" && item.planUnit === 0,
            )
            .map((item, itemIdx) => ({
              className: comp.className,
              item,
              key:
                item.fund?.fundCode ??
                `${comp.classCode || compIdx}-${item.variety}-${itemIdx}`,
            })),
        )
    : [];

  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">长赢计划</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {data ? `净值日期: ${formatNavDate(data.navDate)}` : "加载中..."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-xs border rounded px-2 py-1 hover:bg-muted transition-colors disabled:opacity-50"
            >
              {isFetching ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border bg-muted/50"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            加载失败: {error instanceof Error ? error.message : "未知错误"}
          </div>
        )}

        {data && (
          <>
            <SummaryCard data={data} />

            <div className="border-b border-border pb-1.5">
              <div className="grid grid-cols-11 gap-2 text-xs font-medium text-muted-foreground px-2">
                <div className="col-span-3">品种</div>
                <div className="col-span-2 text-right">计划份数</div>
                <div className="col-span-2 text-right">净值</div>
                <div className="col-span-2 text-right">日涨跌</div>
                <div className="col-span-2 text-right">累计收益</div>
              </div>
            </div>

            <div className="space-y-3">
              {classSections.map(({ composition, items, key }) => {
                const isCollapsed = collapsedClasses[key] ?? false;

                return (
                  <ClassSection
                    key={key}
                    composition={composition}
                    items={items}
                    isCollapsed={isCollapsed}
                    onToggle={() => {
                      setCollapsedClasses((current) => ({
                        ...current,
                        [key]: !(current[key] ?? false),
                      }));
                    }}
                  />
                );
              })}

              {clearedFunds.length > 0 && (
                <div className="rounded-lg border border-dashed">
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">已清仓基金</div>
                      <div className="text-xs text-muted-foreground">
                        共 {clearedFunds.length} 只，默认折叠展示
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowClearedFunds((current) => !current)}
                    >
                      {showClearedFunds
                        ? "收起已清仓基金"
                        : `展开已清仓基金 (${clearedFunds.length})`}
                    </Button>
                  </div>
                  {showClearedFunds && (
                    <div className="border-t divide-y">
                      {clearedFunds.map(({ className, item, key }) => (
                        <CompItemRow key={key} item={item} detail={className} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
