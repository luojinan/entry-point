import { createFileRoute } from "@tanstack/react-router";
import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { jianguoyunMoveSchema } from "@/lib/jianguoyun";
import { moveJianguoyunPath } from "@/lib/server/jianguoyun";
import {
  jianguoyunErrorResponse,
  jianguoyunInvalidInputResponse,
} from "@/lib/server/jianguoyun-api";

export const Route = createFileRoute("/api/jianguoyun/move")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request }) => {
        let body: unknown;

        try {
          body = await request.json();
        } catch {
          return jianguoyunInvalidInputResponse(
            "Request body must be valid JSON",
          );
        }

        const parsed = jianguoyunMoveSchema.safeParse(body);
        if (!parsed.success) {
          return jianguoyunInvalidInputResponse(
            parsed.error.issues[0]?.message || "Invalid move payload",
          );
        }

        try {
          const result = await moveJianguoyunPath(parsed.data);
          return jsonResponse(result, 200, {
            "X-Request-Id": result.requestId,
          });
        } catch (error) {
          console.error("Jianguoyun move error:", error);
          return jianguoyunErrorResponse(
            error,
            "Failed to move Jianguoyun path",
          );
        }
      },
    },
  },
});
