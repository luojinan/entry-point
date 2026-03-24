import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { search } from "@/lib/tg-search/search";
import type { SearchRequest } from "@/lib/tg-search/types";

export const Route = createFileRoute("/api/tg-search")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const keyword = url.searchParams.get("kw");
        const channelsParam = url.searchParams.get("channels");
        const resultTypeParam = url.searchParams.get("res");
        const includePluginsParam = url.searchParams.get("include_plugins");
        const pluginsParam = url.searchParams.get("plugins");

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

        const includePlugins =
          includePluginsParam == null
            ? true
            : includePluginsParam === "1" || includePluginsParam === "true";

        const plugins = pluginsParam
          ? pluginsParam.split(",").map((p) => p.trim())
          : undefined;

        try {
          const data = await search(
            keyword,
            channels,
            resultType,
            includePlugins,
            plugins,
          );
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

          const data = await search(
            body.keyword,
            channels,
            resultType,
            body.include_plugins ?? true,
            body.plugins,
          );
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
