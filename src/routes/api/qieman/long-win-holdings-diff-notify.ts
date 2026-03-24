import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { transformLongWinDiffToMarkdown } from "@/lib/notify/long-win-diff";
import {
  isWecomNotificationSuccessful,
  sendWecomNotification,
  type WecomWebhookResponse,
} from "@/lib/notify/wecom";
import {
  ensureQiemanDiffAuthorized,
  getRequestEnv,
  loadLongWinHoldingsDiff,
  syncLongWinPlanSnapshot,
} from "@/lib/qieman/long-win-holdings-diff";
import {
  DEFAULT_QIEMAN_PROD_CODE,
  type PlanDiffResult,
} from "@/lib/qieman/plan-snapshot";

const DEFAULT_DIFF_NOTIFY_SNAPSHOT_SOURCE =
  "api/qieman/long-win-holdings-diff-notify";

interface NotifyRequestBody {
  prodCode?: string;
  webhookKey?: string;
  snapshotSource?: string;
}

function formatWecomErrorMessage(
  result: WecomWebhookResponse | WecomWebhookResponse[],
) {
  const items = Array.isArray(result) ? result : [result];

  return items
    .map((item, index) => {
      const suffix = items.length > 1 ? `#${index + 1}` : "";
      return `${suffix}${item.errcode ?? "unknown"}:${item.errmsg ?? "unknown error"}`;
    })
    .join(", ");
}

function buildBaseResponse(params: {
  prodCode: string;
  baselineFound: boolean;
  initialized: boolean;
  shouldNotify: boolean;
  notified: boolean;
  diff: PlanDiffResult;
  baselineUpdatedAt: string | null;
  currentFetchedAt: string;
  storageMode: "service_role" | "publishable_key_fallback";
}) {
  return {
    prodCode: params.prodCode,
    baselineFound: params.baselineFound,
    initialized: params.initialized,
    shouldNotify: params.shouldNotify,
    notified: params.notified,
    baselineUpdatedAt: params.baselineUpdatedAt,
    currentFetchedAt: params.currentFetchedAt,
    storageMode: params.storageMode,
    diffSummary: params.diff.summary,
  };
}

export const Route = createFileRoute("/api/qieman/long-win-holdings-diff-notify")(
  {
    server: {
      handlers: {
        OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

        POST: async ({ request, context }) => {
          try {
            const env = getRequestEnv(context);
            const authError = ensureQiemanDiffAuthorized(request, env);
            if (authError) {
              return authError;
            }

            const body = (await request.json()) as NotifyRequestBody;
            if (!body.webhookKey) {
              return errorResponse("Missing required field: webhookKey", 400);
            }

            const prodCode = body.prodCode ?? DEFAULT_QIEMAN_PROD_CODE;
            const result = await loadLongWinHoldingsDiff(request, env, {
              prodCode,
              includeUnchanged: false,
            });

            if (!result.baselineFound) {
              const syncSummary = await syncLongWinPlanSnapshot({
                env,
                prodCode,
                planData: result.planData,
                snapshotSource:
                  body.snapshotSource ?? DEFAULT_DIFF_NOTIFY_SNAPSHOT_SOURCE,
                existingRows: result.baselineRows,
              });

              return jsonResponse({
                ...buildBaseResponse({
                  prodCode,
                  baselineFound: false,
                  initialized: true,
                  shouldNotify: false,
                  notified: false,
                  diff: result.diff,
                  baselineUpdatedAt: result.baselineUpdatedAt,
                  currentFetchedAt: result.currentFetchedAt,
                  storageMode: result.storageMode,
                }),
                syncSummary,
              });
            }

            if (!result.diff.hasChanges) {
              return jsonResponse(
                buildBaseResponse({
                  prodCode,
                  baselineFound: true,
                  initialized: false,
                  shouldNotify: false,
                  notified: false,
                  diff: result.diff,
                  baselineUpdatedAt: result.baselineUpdatedAt,
                  currentFetchedAt: result.currentFetchedAt,
                  storageMode: result.storageMode,
                }),
              );
            }

            const content = transformLongWinDiffToMarkdown({
              prodCode,
              baselineUpdatedAt: result.baselineUpdatedAt,
              currentFetchedAt: result.currentFetchedAt,
              diff: result.diff,
            });
            const wecomResult = (await sendWecomNotification(
              body.webhookKey,
              content,
            )) as WecomWebhookResponse | WecomWebhookResponse[];

            if (!isWecomNotificationSuccessful(wecomResult)) {
              throw new Error(
                `Failed to send WeCom notification: ${formatWecomErrorMessage(wecomResult)}`,
              );
            }

            const syncSummary = await syncLongWinPlanSnapshot({
              env,
              prodCode,
              planData: result.planData,
              snapshotSource:
                body.snapshotSource ?? DEFAULT_DIFF_NOTIFY_SNAPSHOT_SOURCE,
              existingRows: result.baselineRows,
            });

            return jsonResponse({
              ...buildBaseResponse({
                prodCode,
                baselineFound: true,
                initialized: false,
                shouldNotify: true,
                notified: true,
                diff: result.diff,
                baselineUpdatedAt: result.baselineUpdatedAt,
                currentFetchedAt: result.currentFetchedAt,
                storageMode: result.storageMode,
              }),
              syncSummary,
              wecomResult,
            });
          } catch (error) {
            console.error(
              "Error in /api/qieman/long-win-holdings-diff-notify POST:",
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
  },
);
