import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FundInfo, Composition } from "./type";

export const Route = createFileRoute("/qieman/long-win-plan")({
  component: LongWinPlanPage,
});

function formatPercent(value: number | null, fallback = "-"): string {
  if (value === null || value === undefined) return fallback;
  return `${(value * 100).toFixed(2)}%`;
}

function formatNavDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function DailyReturnCell({ value }: { value: number }) {
  const percent = (value * 100).toFixed(2);
  const color = value > 0 ? "text-red-500" : value < 0 ? "text-green-500" : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  return <span className={`font-medium ${color}`}>{sign}{percent}%</span>;
}

function CompItemRow({ item }: { item: FundInfo["composition"][0]["compList"][0] }) {
  const fund = item.fund;
  const unitValue = item.unitValue != null ? (item.unitValue * 100).toFixed(2) : "-";
  const accProfit = formatPercent(item.accProfit);
  const dailyReturn = item.dailyReturn;

  const navDisplay = fund?.nav ?? (item.nav != null ? item.nav.toFixed(4) : "-");
  const navDateDisplay = fund?.navDate ?? (item.navDate != null ? formatNavDate(item.navDate) : "-");

  return (
    <div className="grid grid-cols-11 items-center gap-2 border-b py-2 text-xs last:border-0 hover:bg-muted/30 px-2 rounded">
      <div className="col-span-3 min-w-0">
        <div className="truncate font-medium text-foreground">{item.variety}</div>
        {fund && (
          <div className="truncate text-muted-foreground">{fund.fundCode}</div>
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
        {dailyReturn != null ? <DailyReturnCell value={dailyReturn} /> : <span className="text-muted-foreground">-</span>}
      </div>
      <div className="col-span-2 text-right">
        <span className={item.accProfit > 0 ? "text-red-500" : item.accProfit < 0 ? "text-green-500" : ""}>
          {accProfit}
        </span>
      </div>
    </div>
  );
}

function ClassSection({ composition }: { composition: Composition }) {
  const accProfitRate = formatPercent(composition.accProfitRate);
  const percent = formatPercent(composition.percent);
  const isPositive = composition.accProfitRate > 0;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-medium">{composition.className}</span>
          <Badge variant="outline" className="text-xs">
            {composition.unit}份
          </Badge>
          <span className="text-muted-foreground text-xs">{percent}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">累计收益</span>
          <span className={`font-medium ${isPositive ? "text-red-500" : "text-green-500"}`}>
            {accProfitRate}
          </span>
        </div>
      </div>
      <div className="divide-y">
        {composition.compList.filter((item) => item.variety !== "现金").map((item, idx) => {
          const key = item.fund?.fundCode ?? `${item.variety}-${idx}`;
          return <CompItemRow key={key} item={item} />;
        })}
      </div>
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
          <div className={`mt-1 text-xl font-semibold ${data.annualCompoundedReturn > 0 ? "text-red-500" : "text-green-500"}`}>
            {formatPercent(data.annualCompoundedReturn)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">成立以来收益率</div>
          <div className={`mt-1 text-xl font-semibold ${data.fromSetupReturn > 0 ? "text-red-500" : "text-green-500"}`}>
            {formatPercent(data.fromSetupReturn)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">夏普比率</div>
          <div className="mt-1 text-xl font-semibold">{data.sharpe.toFixed(2)}</div>
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
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">调仓次数</div>
          <div className="mt-1 text-xl font-semibold">{data.adjustedCount}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="text-muted-foreground text-xs">参与人数</div>
          <div className="mt-1 text-xl font-semibold">
            {data.joinedCount.toLocaleString()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LongWinPlanPage() {
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
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              返回首页
            </Link>
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
              <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/50" />
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
              {data.composition
                .filter((comp) => comp.className !== "现金")
                .map((comp, idx) => {
                  const key = comp.classCode ?? `class-${idx}`;
                  return <ClassSection key={key} composition={comp} />;
                })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
