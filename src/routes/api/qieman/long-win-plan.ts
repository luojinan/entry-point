import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import {
  loadLongWinPlan,
  QiemanPlanFetchError,
} from "@/lib/qieman/long-win-plan";

/**
 * 长赢投资方案接口
 * 原始路径: /pmdj/v2/long-win/plan
 * 代理路径: /api/qieman/long-win-plan
 *
 * 查询参数:
 * - prodCode: 产品代码 (必填, 如: LONG_WIN)
 */
export const Route = createFileRoute("/api/qieman/long-win-plan")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        return handleCorsPreflightRequest(request);
      },
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const prodCode = url.searchParams.get("prodCode");

          if (!prodCode) {
            return errorResponse("Missing required parameter: prodCode", 400);
          }

          const data = await loadLongWinPlan(prodCode);
          return jsonResponse(data);
        } catch (error) {
          console.error("Error in /api/qieman/long-win-plan:", error);
          if (error instanceof QiemanPlanFetchError) {
            return errorResponse(error.message, error.status);
          }
          return errorResponse(
            error instanceof Error ? error.message : "Internal server error",
            500,
          );
        }
      },
    },
  },
});
