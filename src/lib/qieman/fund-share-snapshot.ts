import type { SupabaseClient } from "@supabase/supabase-js";

import type { HoldingAsset } from "./types";

export const QIEMAN_FUND_SHARE_SNAPSHOT_TABLE = "qieman_fund_share_snapshots";
export const DEFAULT_QIEMAN_PROD_CODE = "LONG_WIN";
export const DEFAULT_SNAPSHOT_SOURCE = "api/qieman/long-win-assets";

const SHARE_EPSILON = 0.00000001;

export type FundShareDiffAction =
  | "UNCHANGED"
  | "BUY"
  | "SELL"
  | "NEW"
  | "CLEAR";

export interface FundShareSnapshotRow {
  id: number;
  capital_account_id: string;
  prod_code: string;
  fund_code: string;
  fund_name: string;
  shares: number;
  nav: number | null;
  nav_date: string | null;
  market_value: number | null;
  cost: number | null;
  profit: number | null;
  profit_rate: number | null;
  daily_profit: number | null;
  daily_return: number | null;
  variety: string | null;
  class_code: string | null;
  class_name: string | null;
  snapshot_source: string;
  snapshot_at: string;
  created_at: string;
  updated_at: string;
}

export interface FundShareSnapshotRecord {
  fundCode: string;
  fundName: string;
  shares: number;
  nav: number | null;
  navDate: string | null;
  marketValue: number | null;
  cost: number | null;
  profit: number | null;
  profitRate: number | null;
  dailyProfit: number | null;
  dailyReturn: number | null;
  variety: string | null;
  classCode: string | null;
  className: string | null;
}

export interface FundShareDiffItem extends FundShareSnapshotRecord {
  action: FundShareDiffAction;
  previousShares: number | null;
  currentShares: number | null;
  deltaShares: number | null;
}

export interface FundShareDiffResult {
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
  changes: FundShareDiffItem[];
}

export interface SyncFundShareSnapshotInput {
  capitalAccountId: string;
  prodCode: string;
  holdings: HoldingAsset[];
  snapshotSource?: string;
  existingRows?: FundShareSnapshotRow[];
}

function normalizeNullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeHoldingAsset(
  asset: HoldingAsset,
): FundShareSnapshotRecord {
  return {
    fundCode: asset.fundCode,
    fundName: asset.fundName,
    shares: asset.shares,
    nav: normalizeNullableNumber(asset.nav),
    navDate: asset.navDate ?? null,
    marketValue: normalizeNullableNumber(asset.marketValue),
    cost: normalizeNullableNumber(asset.cost),
    profit: normalizeNullableNumber(asset.profit),
    profitRate: normalizeNullableNumber(asset.profitRate),
    dailyProfit: normalizeNullableNumber(asset.dailyProfit),
    dailyReturn: normalizeNullableNumber(asset.dailyReturn),
    variety: asset.variety ?? null,
    classCode: asset.classCode ?? null,
    className: asset.className ?? null,
  };
}

function normalizeSnapshotRow(
  row: FundShareSnapshotRow,
): FundShareSnapshotRecord {
  return {
    fundCode: row.fund_code,
    fundName: row.fund_name,
    shares: row.shares,
    nav: row.nav,
    navDate: row.nav_date,
    marketValue: row.market_value,
    cost: row.cost,
    profit: row.profit,
    profitRate: row.profit_rate,
    dailyProfit: row.daily_profit,
    dailyReturn: row.daily_return,
    variety: row.variety,
    classCode: row.class_code,
    className: row.class_name,
  };
}

function buildDiffAction(
  previousShares: number | null,
  currentShares: number | null,
): FundShareDiffAction {
  if (previousShares === null && currentShares !== null) {
    return "NEW";
  }

  if (previousShares !== null && currentShares === null) {
    return "CLEAR";
  }

  if (previousShares === null || currentShares === null) {
    return "UNCHANGED";
  }

  const delta = currentShares - previousShares;
  if (Math.abs(delta) <= SHARE_EPSILON) {
    return "UNCHANGED";
  }

  return delta > 0 ? "BUY" : "SELL";
}

export function getLatestSnapshotUpdatedAt(rows: FundShareSnapshotRow[]) {
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

export function computeFundShareDiff(params: {
  baselineRows: FundShareSnapshotRow[];
  currentHoldings: HoldingAsset[];
  includeUnchanged?: boolean;
}): FundShareDiffResult {
  const baselineMap = new Map(
    params.baselineRows.map((row) => [
      row.fund_code,
      normalizeSnapshotRow(row),
    ]),
  );
  const currentMap = new Map(
    params.currentHoldings.map((holding) => {
      const normalized = normalizeHoldingAsset(holding);
      return [normalized.fundCode, normalized];
    }),
  );

  const fundCodes = Array.from(
    new Set([...baselineMap.keys(), ...currentMap.keys()]),
  ).sort();

  const allChanges = fundCodes
    .map((fundCode) => {
      const previous = baselineMap.get(fundCode) ?? null;
      const current = currentMap.get(fundCode) ?? null;
      const previousShares = previous?.shares ?? null;
      const currentShares = current?.shares ?? null;
      const deltaShares =
        previousShares === null || currentShares === null
          ? null
          : currentShares - previousShares;
      const action = buildDiffAction(previousShares, currentShares);
      const source = current ?? previous;

      if (!source) {
        return null;
      }

      return {
        ...source,
        action,
        previousShares,
        currentShares,
        deltaShares,
      } satisfies FundShareDiffItem;
    })
    .filter((item): item is FundShareDiffItem => Boolean(item));

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

export async function listFundShareSnapshots(
  supabase: SupabaseClient,
  capitalAccountId: string,
  prodCode: string,
) {
  const { data, error } = await supabase
    .from(QIEMAN_FUND_SHARE_SNAPSHOT_TABLE)
    .select("*")
    .eq("capital_account_id", capitalAccountId)
    .eq("prod_code", prodCode)
    .order("fund_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to query fund share snapshots: ${error.message}`);
  }

  return (data ?? []) as FundShareSnapshotRow[];
}

export async function syncFundShareSnapshots(
  supabase: SupabaseClient,
  input: SyncFundShareSnapshotInput,
) {
  const existingRows =
    input.existingRows ??
    (await listFundShareSnapshots(
      supabase,
      input.capitalAccountId,
      input.prodCode,
    ));
  const snapshotAt = new Date().toISOString();
  const payload = input.holdings.map((holding) => {
    const normalized = normalizeHoldingAsset(holding);

    return {
      capital_account_id: input.capitalAccountId,
      prod_code: input.prodCode,
      fund_code: normalized.fundCode,
      fund_name: normalized.fundName,
      shares: normalized.shares,
      nav: normalized.nav,
      nav_date: normalized.navDate,
      market_value: normalized.marketValue,
      cost: normalized.cost,
      profit: normalized.profit,
      profit_rate: normalized.profitRate,
      daily_profit: normalized.dailyProfit,
      daily_return: normalized.dailyReturn,
      variety: normalized.variety,
      class_code: normalized.classCode,
      class_name: normalized.className,
      snapshot_source: input.snapshotSource ?? DEFAULT_SNAPSHOT_SOURCE,
      snapshot_at: snapshotAt,
    };
  });

  if (payload.length > 0) {
    const { error } = await supabase
      .from(QIEMAN_FUND_SHARE_SNAPSHOT_TABLE)
      .upsert(payload, {
        onConflict: "capital_account_id,prod_code,fund_code",
      });

    if (error) {
      throw new Error(
        `Failed to upsert fund share snapshots: ${error.message}`,
      );
    }
  }

  const currentFundCodes = new Set(payload.map((item) => item.fund_code));
  const removedFundCodes = existingRows
    .map((row) => row.fund_code)
    .filter((fundCode) => !currentFundCodes.has(fundCode));

  if (removedFundCodes.length > 0) {
    const { error } = await supabase
      .from(QIEMAN_FUND_SHARE_SNAPSHOT_TABLE)
      .delete()
      .eq("capital_account_id", input.capitalAccountId)
      .eq("prod_code", input.prodCode)
      .in("fund_code", removedFundCodes);

    if (error) {
      throw new Error(`Failed to delete removed snapshots: ${error.message}`);
    }
  }

  if (payload.length === 0 && existingRows.length > 0) {
    const { error } = await supabase
      .from(QIEMAN_FUND_SHARE_SNAPSHOT_TABLE)
      .delete()
      .eq("capital_account_id", input.capitalAccountId)
      .eq("prod_code", input.prodCode);

    if (error) {
      throw new Error(`Failed to clear fund share snapshots: ${error.message}`);
    }
  }

  return {
    snapshotAt,
    upsertedCount: payload.length,
    removedCount: removedFundCodes.length,
  };
}
