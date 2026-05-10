import { createFileRoute } from "@tanstack/react-router";

import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { listChatModelOptions } from "@/lib/server/llm-config";
import { getRequestEnv } from "@/lib/supabase-server";

export const Route = createFileRoute("/api/ai-models")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ context }) => {
        try {
          const env = getRequestEnv(context);
          const models = await listChatModelOptions(env);
          return jsonResponse(models);
        } catch (error) {
          console.error("Error in /api/ai-models:", error);
          return errorResponse(
            error instanceof Error ? error.message : "Failed to load AI models",
            500,
          );
        }
      },
    },
  },
});
