import { createFileRoute } from "@tanstack/react-router";
import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { jianguoyunQueryPathSchema } from "@/lib/jianguoyun";
import { listJianguoyunPath } from "@/lib/server/jianguoyun";
import {
  jianguoyunErrorResponse,
  jianguoyunInvalidInputResponse,
} from "@/lib/server/jianguoyun-api";

export const Route = createFileRoute("/api/jianguoyun/list")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = jianguoyunQueryPathSchema.safeParse({
          path: url.searchParams.get("path"),
        });

        if (!parsed.success) {
          return jianguoyunInvalidInputResponse(
            parsed.error.issues[0]?.message ||
              "Missing required parameter: path",
          );
        }

        try {
          const result = await listJianguoyunPath(parsed.data.path);
          return jsonResponse(result, 200, {
            "X-Request-Id": result.requestId,
          });
        } catch (error) {
          console.error("Jianguoyun list error:", error);
          return jianguoyunErrorResponse(
            error,
            "Failed to list Jianguoyun path",
          );
        }
      },
    },
  },
});
