import { createFileRoute } from "@tanstack/react-router";
import {
	errorResponse,
	handleCorsPreflightRequest,
	jsonResponse,
} from "@/lib/api-utils";
import type { FundInfo, QiemanResponse } from "./type";

/**
 * 生成 x-sign 签名（与 test.tsx 中 createSign 逻辑一致）
 * ts + SHA256(floor(1.01 * ts)).toUpperCase().substring(0, 32)
 */
async function createSign(): Promise<string> {
	const ts = Date.now();
	const value = Math.floor(1.01 * ts).toString();
	const data = new TextEncoder().encode(value);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hash = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
	return `${ts}${hash.substring(0, 32)}`;
}

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
						return errorResponse(
							"Missing required parameter: prodCode",
							400,
						);
					}

					const xSign = await createSign();
					const apiUrl = `https://qieman.com/pmdj/v2/long-win/plan?prodCode=${encodeURIComponent(prodCode)}`;

					const response = await fetch(apiUrl, {
						headers: {
							"x-sign": xSign,
						},
					});

					if (!response.ok) {
						const errorText = await response.text();
						return errorResponse(
							`Qieman API error: ${response.status} - ${errorText}`,
							response.status,
						);
					}

					const data: QiemanResponse<FundInfo> = await response.json();
					return jsonResponse(data);
				} catch (error) {
					console.error(
						"Error in /api/qieman/long-win-plan:",
						error,
					);
					return errorResponse(
						error instanceof Error
							? error.message
							: "Internal server error",
						500,
					);
				}
			},
		},
	},
});
