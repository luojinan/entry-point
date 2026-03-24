import { errorResponse } from "@/lib/api-utils";
import {
  createSupabaseServerClient,
  getRuntimeEnvValue,
  getSupabaseServerConfig,
} from "@/lib/supabase-server";
import { loadLongWinPlan } from "./long-win-plan";
import {
  computePlanDiff,
  getLatestSnapshotUpdatedAt,
  listPlanSnapshots,
  type PlanDiffResult,
  type QiemanPlanSnapshotRow,
  syncPlanSnapshots,
} from "./plan-snapshot";
import type { LongWinPlanResponse } from "./types";

export type RuntimeEnv = Record<string, string | undefined> | undefined;

export interface LoadLongWinHoldingsDiffOptions {
  prodCode: string;
  includeUnchanged?: boolean;
}

export interface LoadedLongWinHoldingsDiff {
  prodCode: string;
  planData: LongWinPlanResponse;
  baselineRows: QiemanPlanSnapshotRow[];
  baselineFound: boolean;
  baselineUpdatedAt: string | null;
  currentFetchedAt: string;
  diff: PlanDiffResult;
  storageMode: "service_role" | "publishable_key_fallback";
}

export function getRequestEnv(context: unknown): RuntimeEnv {
  const cloudflare = (
    context as { cloudflare?: { env?: RuntimeEnv } } | undefined
  )?.cloudflare;
  return cloudflare?.env;
}

export function ensureQiemanDiffAuthorized(
  request: Request,
  env: RuntimeEnv,
): Response | null {
  const expectedApiKey = getRuntimeEnvValue(env, "QIEMAN_DIFF_API_KEY");

  if (!expectedApiKey) {
    return null;
  }

  const receivedApiKey = request.headers.get("x-api-key");
  if (receivedApiKey === expectedApiKey) {
    return null;
  }

  return errorResponse("Unauthorized", 401);
}

export async function loadLongWinHoldingsDiff(
  _request: Request,
  env: RuntimeEnv,
  options: LoadLongWinHoldingsDiffOptions,
): Promise<LoadedLongWinHoldingsDiff> {
  const planData = await loadLongWinPlan(options.prodCode);
  const supabase = createSupabaseServerClient(env);
  const baselineRows = await listPlanSnapshots(supabase, options.prodCode);
  const diff = computePlanDiff({
    baselineRows,
    currentPlanData: planData,
    includeUnchanged: options.includeUnchanged,
  });
  const storageConfig = getSupabaseServerConfig(env);

  return {
    prodCode: options.prodCode,
    planData,
    baselineRows,
    baselineFound: baselineRows.length > 0,
    baselineUpdatedAt: getLatestSnapshotUpdatedAt(baselineRows),
    currentFetchedAt: new Date().toISOString(),
    diff,
    storageMode: storageConfig.isServiceRole
      ? "service_role"
      : "publishable_key_fallback",
  };
}

export async function syncLongWinPlanSnapshot(params: {
  env: RuntimeEnv;
  prodCode: string;
  planData: LongWinPlanResponse;
  snapshotSource: string;
  existingRows: QiemanPlanSnapshotRow[];
}) {
  const supabase = createSupabaseServerClient(params.env);

  return syncPlanSnapshots(supabase, {
    prodCode: params.prodCode,
    planData: params.planData,
    snapshotSource: params.snapshotSource,
    existingRows: params.existingRows,
  });
}
