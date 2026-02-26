import { createFileRoute } from "@tanstack/react-router";
import { searchTG } from "@/lib/tg-search/search";
import type { SearchRequest } from "@/lib/tg-search/types";

export const Route = createFileRoute("/api/tg-search")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const keyword = url.searchParams.get("kw");
				const channelsParam = url.searchParams.get("channels");
				const resultTypeParam = url.searchParams.get("res");

				if (!keyword) {
					return new Response(
						JSON.stringify({
							code: 400,
							message: "Missing required parameter: kw",
						}),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						},
					);
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

					return new Response(
						JSON.stringify({
							code: 0,
							message: "success",
							data,
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					);
				} catch (error) {
					console.error("TG search error:", error);
					return new Response(
						JSON.stringify({
							code: 500,
							message:
								error instanceof Error ? error.message : "Internal server error",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			},

			POST: async ({ request }) => {
				try {
					const body = (await request.json()) as SearchRequest;

					if (!body.keyword) {
						return new Response(
							JSON.stringify({
								code: 400,
								message: "Missing required field: keyword",
							}),
							{
								status: 400,
								headers: { "Content-Type": "application/json" },
							},
						);
					}

					const channels = body.channels;
					const resultType = body.result_type || "merged_by_type";

					const data = await searchTG(body.keyword, channels, resultType);

					return new Response(
						JSON.stringify({
							code: 0,
							message: "success",
							data,
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					);
				} catch (error) {
					console.error("TG search error:", error);
					return new Response(
						JSON.stringify({
							code: 500,
							message:
								error instanceof Error ? error.message : "Internal server error",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			},
		},
	},
});
