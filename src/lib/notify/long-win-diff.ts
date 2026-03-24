import type { PlanDiffItem, PlanDiffResult } from "@/lib/qieman/plan-snapshot";

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatPlanUnit(value: number | null) {
  if (value === null) {
    return "-";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function formatDelta(value: number | null) {
  if (value === null) {
    return "-";
  }

  const formatted = formatPlanUnit(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function sortChanges(changes: PlanDiffItem[]) {
  const actionRank: Record<PlanDiffItem["action"], number> = {
    BUY: 0,
    SELL: 1,
    NEW: 2,
    CLEAR: 3,
    UNCHANGED: 4,
  };

  return [...changes].sort((left, right) => {
    const rankDiff = actionRank[left.action] - actionRank[right.action];
    if (rankDiff !== 0) {
      return rankDiff;
    }

    const classNameDiff = (left.className ?? "").localeCompare(
      right.className ?? "",
      "zh-CN",
    );
    if (classNameDiff !== 0) {
      return classNameDiff;
    }

    return left.fundCode.localeCompare(right.fundCode, "zh-CN");
  });
}

function renderChangeLine(item: PlanDiffItem) {
  const actionLabelMap: Record<PlanDiffItem["action"], string> = {
    BUY: "加仓",
    SELL: "减仓",
    NEW: "新增",
    CLEAR: "清仓",
    UNCHANGED: "不变",
  };

  return [
    `- ${actionLabelMap[item.action]} 【${item.fundCode}】${item.fundName}`,
    `  ${formatPlanUnit(item.previousPlanUnit)} -> ${formatPlanUnit(item.currentPlanUnit)} (${formatDelta(item.deltaPlanUnit)})`,
  ].join("\n");
}

export function transformLongWinDiffToMarkdown(params: {
  prodCode: string;
  baselineUpdatedAt: string | null;
  currentFetchedAt: string;
  diff: PlanDiffResult;
}) {
  const { diff } = params;
  const lines = [
    `# 长赢持仓调仓提醒`,
    "",
    `快照时间: ${formatDateTime(params.baselineUpdatedAt)}`,
    "",
  ];

  for (const item of sortChanges(diff.changes)) {
    lines.push(renderChangeLine(item));
    lines.push("");
  }

  return lines.join("\n").trim();
}
