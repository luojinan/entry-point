import { createFileRoute } from "@tanstack/react-router";
import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { jianguoyunWriteSchema } from "@/lib/jianguoyun";
import { getRequestEnv } from "@/lib/runtime-env";
import { writeJianguoyunText } from "@/lib/server/jianguoyun";
import {
  jianguoyunErrorResponse,
  jianguoyunInvalidInputResponse,
} from "@/lib/server/jianguoyun-api";

export const Route = createFileRoute("/api/jianguoyun/write")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        let body: unknown;
        const env = getRequestEnv(context);

        try {
          body = await request.json();
        } catch {
          return jianguoyunInvalidInputResponse(
            "Request body must be valid JSON",
          );
        }

        const parsed = jianguoyunWriteSchema.safeParse(body);
        if (!parsed.success) {
          return jianguoyunInvalidInputResponse(
            parsed.error.issues[0]?.message || "Invalid write payload",
          );
        }

        try {
          const result = await writeJianguoyunText(parsed.data, env);
          return jsonResponse(result, 200, {
            "X-Request-Id": result.requestId,
          });
        } catch (error) {
          console.error("Jianguoyun write error:", error);
          return jianguoyunErrorResponse(
            error,
            "Failed to write Jianguoyun file",
          );
        }
      },
    },
  },
});
