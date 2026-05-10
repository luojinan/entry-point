import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompListItem, LongWinPlanResponse } from "./types";

export const QIEMAN_PLAN_SNAPSHOT_TABLE = "qieman_plan_snapshots";
export const DEFAULT_QIEMAN_PROD_CODE = "LONG_WIN";
export const DEFAULT_PLAN_SNAPSHOT_SOURCE = "api/qieman/long-win-plan";

const PLAN_UNIT_EPSILON = 0.00000001;

export type PlanDiffAction = "UNCHANGED" | "BUY" | "SELL" | "NEW" | "CLEAR";

export interface QiemanPlanSnapshotRow {
  id: number;
  prod_code: string;
  fund_code: string;
  fund_name: string;
  class_code: string | null;
  class_name: string | null;
  variety: string;
  plan_unit: number;
  unit_value: number | null;
  percent: number | null;
  nav: number | null;
  nav_date: string | null;
  daily_return: number | null;
  acc_profit: number | null;
  snapshot_source: string;
  snapshot_at: string;
  created_at: string;
  updated_at: string;
}

export interface PlanSnapshotRecord {
  fundCode: string;
  fundName: string;
  classCode: string | null;
  className: string | null;
  variety: string;
  planUnit: number;
  unitValue: number | null;
  percent: number | null;
  nav: number | null;
  navDate: string | null;
  dailyReturn: number | null;
  accProfit: number | null;
}

export interface PlanDiffItem extends PlanSnapshotRecord {
  action: PlanDiffAction;
  previousPlanUnit: number | null;
  currentPlanUnit: number | null;
  deltaPlanUnit: number | null;
}

export interface PlanDiffResult {
  hasChanges: boolean;
  summary: {
    total: number;
    changed: number;
    buy: number;
    sell: number;
    newlyAdded: number;
    cleared: number;
    unchanged: number;
  };
  changes: PlanDiffItem[];
}

export interface SyncPlanSnapshotInput {
  prodCode: string;
  planData: LongWinPlanResponse;
  snapshotSource?: string;
  existingRows?: QiemanPlanSnapshotRow[];
}

function normalizeNullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toPlanSnapshotRecord(
  item: CompListItem,
  classCode: string | null,
  className: string | null,
): PlanSnapshotRecord {
  const fund = item.fund;
  return {
    fundCode: fund?.fundCode ?? "",
    fundName: fund?.fundName ?? item.variety,
    classCode,
    className,
    variety: item.variety,
    planUnit: item.planUnit,
    unitValue: normalizeNullableNumber(item.unitValue),
    percent: normalizeNullableNumber(item.percent),
    nav: normalizeNullableNumber(item.nav),
    navDate:
      item.navDate != null && item.navDate > 0
        ? new Date(item.navDate).toISOString().slice(0, 10)
        : (fund?.navDate ?? null),
    dailyReturn: normalizeNullableNumber(item.dailyReturn),
    accProfit: normalizeNullableNumber(item.accProfit),
  };
}

function normalizeSnapshotRow(row: QiemanPlanSnapshotRow): PlanSnapshotRecord {
  return {
    fundCode: row.fund_code,
    fundName: row.fund_name,
    classCode: row.class_code,
    className: row.class_name,
    variety: row.variety,
    planUnit: Number(row.plan_unit),
    unitValue: row.unit_value,
    percent: row.percent,
    nav: row.nav,
    navDate: row.nav_date,
    dailyReturn: row.daily_return,
    accProfit: row.acc_profit,
  };
}

function buildDiffAction(
  previousPlanUnit: number | null,
  currentPlanUnit: number | null,
): PlanDiffAction {
  if (previousPlanUnit === null && currentPlanUnit !== null) {
    return "NEW";
  }

  if (previousPlanUnit !== null && currentPlanUnit === null) {
    return "CLEAR";
  }

  if (previousPlanUnit === null || currentPlanUnit === null) {
    return "UNCHANGED";
  }

  const delta = currentPlanUnit - previousPlanUnit;
  if (Math.abs(delta) <= PLAN_UNIT_EPSILON) {
    return "UNCHANGED";
  }

  return delta > 0 ? "BUY" : "SELL";
}

export function getLatestSnapshotUpdatedAt(rows: QiemanPlanSnapshotRow[]) {
  if (rows.length === 0) {
    return null;
  }

  return rows.reduce((latest, row) => {
    if (!latest) {
      return row.updated_at;
    }

    return new Date(row.updated_at) > new Date(latest)
      ? row.updated_at
      : latest;
  }, rows[0]?.updated_at ?? null);
}

export function flattenPlanComposition(
  planData: LongWinPlanResponse,
): PlanSnapshotRecord[] {
  return planData.composition
    .filter((comp) => !comp.isCash && comp.className !== "现金")
    .flatMap((comp) =>
      comp.compList
        .filter((item) => item.variety !== "现金")
        .map((item) =>
          toPlanSnapshotRecord(item, comp.classCode, comp.className),
        ),
    );
}

export function computePlanDiff(params: {
  baselineRows: QiemanPlanSnapshotRow[];
  currentPlanData: LongWinPlanResponse;
  includeUnchanged?: boolean;
}): PlanDiffResult {
  const baselineMap = new Map(
    params.baselineRows.map((row) => [
      row.fund_code,
      normalizeSnapshotRow(row),
    ]),
  );
  const currentItems = flattenPlanComposition(params.currentPlanData);
  const currentMap = new Map(currentItems.map((item) => [item.fundCode, item]));

  const fundCodes = Array.from(
    new Set([...baselineMap.keys(), ...currentMap.keys()]),
  ).sort();

  const allChanges = fundCodes
    .map((fundCode) => {
      const previous = baselineMap.get(fundCode) ?? null;
      const current = currentMap.get(fundCode) ?? null;
      const previousPlanUnit = previous?.planUnit ?? null;
      const currentPlanUnit = current?.planUnit ?? null;
      const deltaPlanUnit =
        previousPlanUnit === null || currentPlanUnit === null
          ? null
          : currentPlanUnit - previousPlanUnit;
      const action = buildDiffAction(previousPlanUnit, currentPlanUnit);
      const source = current ?? previous;

      if (!source) {
        return null;
      }

      return {
        ...source,
        action,
        previousPlanUnit,
        currentPlanUnit,
        deltaPlanUnit,
      } satisfies PlanDiffItem;
    })
    .filter((item): item is PlanDiffItem => Boolean(item));

  const summary = allChanges.reduce(
    (acc, item) => {
      acc.total += 1;

      switch (item.action) {
        case "BUY":
          acc.changed += 1;
          acc.buy += 1;
          break;
        case "SELL":
          acc.changed += 1;
          acc.sell += 1;
          break;
        case "NEW":
          acc.changed += 1;
          acc.newlyAdded += 1;
          break;
        case "CLEAR":
          acc.changed += 1;
          acc.cleared += 1;
          break;
        case "UNCHANGED":
          acc.unchanged += 1;
          break;
      }

      return acc;
    },
    {
      total: 0,
      changed: 0,
      buy: 0,
      sell: 0,
      newlyAdded: 0,
      cleared: 0,
      unchanged: 0,
    },
  );

  const changes = params.includeUnchanged
    ? allChanges
    : allChanges.filter((item) => item.action !== "UNCHANGED");

  return {
    hasChanges: summary.changed > 0,
    summary,
    changes,
  };
}

export async function listPlanSnapshots(
  supabase: SupabaseClient,
  prodCode: string,
) {
  const { data, error } = await supabase
    .from(QIEMAN_PLAN_SNAPSHOT_TABLE)
    .select("*")
    .eq("prod_code", prodCode)
    .order("fund_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to query plan snapshots: ${error.message}`);
  }

  return (data ?? []) as QiemanPlanSnapshotRow[];
}

export async function syncPlanSnapshots(
  supabase: SupabaseClient,
  input: SyncPlanSnapshotInput,
) {
  const existingRows =
    input.existingRows ?? (await listPlanSnapshots(supabase, input.prodCode));
  const snapshotAt = new Date().toISOString();

  const currentItems = flattenPlanComposition(input.planData);
  const payload = currentItems.map((item) => ({
    prod_code: input.prodCode,
    fund_code: item.fundCode,
    fund_name: item.fundName,
    class_code: item.classCode,
    class_name: item.className,
    variety: item.variety,
    plan_unit: item.planUnit,
    unit_value: item.unitValue,
    percent: item.percent,
    nav: item.nav,
    nav_date: item.navDate,
    daily_return: item.dailyReturn,
    acc_profit: item.accProfit,
    snapshot_source: input.snapshotSource ?? DEFAULT_PLAN_SNAPSHOT_SOURCE,
    snapshot_at: snapshotAt,
  }));

  if (payload.length > 0) {
    const { error } = await supabase
      .from(QIEMAN_PLAN_SNAPSHOT_TABLE)
      .upsert(payload, {
        onConflict: "prod_code,fund_code",
      });

    if (error) {
      throw new Error(`Failed to upsert plan snapshots: ${error.message}`);
    }
  }

  const currentFundCodes = new Set(payload.map((item) => item.fund_code));
  const removedFundCodes = existingRows
    .map((row) => row.fund_code)
    .filter((fundCode) => !currentFundCodes.has(fundCode));

  if (removedFundCodes.length > 0) {
    const { error } = await supabase
      .from(QIEMAN_PLAN_SNAPSHOT_TABLE)
      .delete()
      .eq("prod_code", input.prodCode)
      .in("fund_code", removedFundCodes);

    if (error) {
      throw new Error(`Failed to delete removed snapshots: ${error.message}`);
    }
  }

  if (payload.length === 0 && existingRows.length > 0) {
    const { error } = await supabase
      .from(QIEMAN_PLAN_SNAPSHOT_TABLE)
      .delete()
      .eq("prod_code", input.prodCode);

    if (error) {
      throw new Error(`Failed to clear plan snapshots: ${error.message}`);
    }
  }

  return {
    snapshotAt,
    upsertedCount: payload.length,
    removedCount: removedFundCodes.length,
  };
}
