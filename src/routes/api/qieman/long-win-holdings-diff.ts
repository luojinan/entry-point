import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import {
  DEFAULT_PLAN_SNAPSHOT_SOURCE,
  DEFAULT_QIEMAN_PROD_CODE,
} from "@/lib/qieman/plan-snapshot";
import {
  ensureQiemanDiffAuthorized,
  getRequestEnv,
  loadLongWinHoldingsDiff,
  syncLongWinPlanSnapshot,
} from "@/lib/qieman/long-win-holdings-diff";

interface SyncRequestBody {
  prodCode?: string;
  snapshotSource?: string;
}

function parseBooleanParam(value: string | null, defaultValue = false) {
  if (value === null) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const Route = createFileRoute("/api/qieman/long-win-holdings-diff")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ request, context }) => {
        try {
          const env = getRequestEnv(context);
          const authError = ensureQiemanDiffAuthorized(request, env);
          if (authError) {
            return authError;
          }

          const url = new URL(request.url);
          const prodCode =
            url.searchParams.get("prodCode") ?? DEFAULT_QIEMAN_PROD_CODE;
          const includeUnchanged = parseBooleanParam(
            url.searchParams.get("includeUnchanged"),
            false,
          );
          const result = await loadLongWinHoldingsDiff(request, env, {
            prodCode,
            includeUnchanged,
          });

          return jsonResponse({
            prodCode: result.prodCode,
            baselineFound: result.baselineFound,
            baselineUpdatedAt: result.baselineUpdatedAt,
            currentFetchedAt: result.currentFetchedAt,
            storageMode: result.storageMode,
            baselineCount: result.baselineRows.length,
            currentCount: result.diff.summary.total,
            diff: result.diff,
          });
        } catch (error) {
          console.error(
            "Error in /api/qieman/long-win-holdings-diff GET:",
            error,
          );
          return errorResponse(
            error instanceof Error ? error.message : "Internal server error",
            500,
          );
        }
      },

      POST: async ({ request, context }) => {
        try {
          const env = getRequestEnv(context);
          const authError = ensureQiemanDiffAuthorized(request, env);
          if (authError) {
            return authError;
          }

          const body = (await request.json()) as SyncRequestBody;
          const prodCode = body.prodCode ?? DEFAULT_QIEMAN_PROD_CODE;
          const result = await loadLongWinHoldingsDiff(request, env, {
            prodCode,
            includeUnchanged: false,
          });
          const syncSummary = await syncLongWinPlanSnapshot({
            env,
            prodCode,
            planData: result.planData,
            snapshotSource: body.snapshotSource ?? DEFAULT_PLAN_SNAPSHOT_SOURCE,
            existingRows: result.baselineRows,
          });

          return jsonResponse({
            prodCode: result.prodCode,
            syncSummary,
            storageMode: result.storageMode,
            diffBeforeSync: result.diff,
          });
        } catch (error) {
          console.error(
            "Error in /api/qieman/long-win-holdings-diff POST:",
            error,
          );
          return errorResponse(
            error instanceof Error ? error.message : "Internal server error",
            500,
          );
        }
      },
    },
  },
});
