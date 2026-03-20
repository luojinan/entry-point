import { createFileRoute } from "@tanstack/react-router";
import {
	errorResponse,
	handleCorsPreflightRequest,
	jsonResponse,
} from "@/lib/api-utils";
import { mockLongWinData } from "@/lib/qieman/mock-data";
import { QiemanClient } from "@/lib/qieman/client";

/**
 * 长赢计划主信息接口
 * 原始路径: /pmdj/v2/long-win
 * 模拟路径: /api/qieman/long-win
 *
 * 查询参数:
 * - userPropertyId: 用户持仓ID (必填)
 * - extClassify: 是否扩展分类 (可选, 默认 true)
 *
 * 环境变量:
 * - QIEMAN_USE_MOCK: "true" 使用 mock 数据, "false" 使用真实 API (默认 false)
 * - QIEMAN_API_TOKEN: 且慢 API Bearer Token (真实 API 时必填)
 */
export const Route = createFileRoute("/api/qieman/long-win")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => {
				return handleCorsPreflightRequest(request);
			},
			GET: async ({ request, context }) => {
				try {
					const url = new URL(request.url);
					const userPropertyId = url.searchParams.get("userPropertyId");

					// 参数校验
					if (!userPropertyId) {
						return errorResponse("Missing required parameter: userPropertyId", 400);
					}

					// 检查是否使用 Mock 数据
					const env = context.cloudflare?.env as Record<string, string> | undefined;
					const useMock = env?.QIEMAN_USE_MOCK === "true";

					if (useMock) {
						// 返回 Mock 数据
						return jsonResponse(mockLongWinData);
					}

					// 使用真实 API (token expires ~2026-04-09)
					const token = env?.QIEMAN_API_TOKEN || "eyJ2ZXIiOiJ2MSIsImFsZyI6IkhTNTEyIn0.eyJzdWIiOiIxNzg0MDMwIiwiaXNzIjoic3NvLnFpZW1hbi5jb20iLCJleHAiOjE3NzU4ODE4ODgsImlhdCI6MTc3MzI4OTg4OCwibG9naW5Nb2RlIjoiV0VDSEFUIiwiaXNBcHBsZVVzZXJOb1Bob25lIjpmYWxzZSwianRpIjoiZDA1ZTFjM2ItNWM2OS00M2NjLTgzODAtM2ZhMDkzYTA3ZTY1In0.eLQtGZs-HC6-gpNX0y6nyOX1U1Q-gU8KsXaf-w6W6SwZ42DC031hUXTjX28gkrkpYetmhtGTwDaXlxj3oQdAvQ";

					const client = new QiemanClient({
						baseUrl: "https://qieman.com",
						token,
						useMock: false,
					});

					const data = await client.getLongWin(userPropertyId);
					return jsonResponse(data);
				} catch (error) {
					console.error("Error in /api/qieman/long-win:", error);
					return errorResponse(
						error instanceof Error ? error.message : "Internal server error",
						500,
					);
				}
			},
		},
	},
});
