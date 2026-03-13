import { createFileRoute } from "@tanstack/react-router";
import { searchTG } from "@/lib/tg-search/search";
import type { SearchRequest } from "@/lib/tg-search/types";
import {
	jsonResponse,
	errorResponse,
	handleCorsPreflightRequest,
} from "@/lib/api-utils";

export const Route = createFileRoute("/api/tg-search")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

			GET: async ({ request }) => {
				const url = new URL(request.url);
				const keyword = url.searchParams.get("kw");
				const channelsParam = url.searchParams.get("channels");
				const resultTypeParam = url.searchParams.get("res");

				if (!keyword) {
					return errorResponse("Missing required parameter: kw", 400);
				}

				const channels = channelsParam
					? channelsParam.split(",").map((c) => c.trim())
					: undefined;

				const resultType =
					resultTypeParam === "results" || resultTypeParam === "all"
						? resultTypeParam
						: "merged_by_type";

				try {
					const data = await searchTG(keyword, channels, resultType);
					return jsonResponse(data);
				} catch (error) {
					console.error("TG search error:", error);
					return errorResponse(
						error instanceof Error ? error.message : "Internal server error",
						500,
					);
				}
			},

			POST: async ({ request }) => {
				try {
					const body = (await request.json()) as SearchRequest;

					if (!body.keyword) {
						return errorResponse("Missing required field: keyword", 400);
					}

					const channels = body.channels;
					const resultType = body.result_type || "merged_by_type";

					const data = await searchTG(body.keyword, channels, resultType);
					return jsonResponse(data);
				} catch (error) {
					console.error("TG search error:", error);
					return errorResponse(
						error instanceof Error ? error.message : "Internal server error",
						500,
					);
				}
			},
		},
	},
});
