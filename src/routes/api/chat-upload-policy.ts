import { createFileRoute } from "@tanstack/react-router";

import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import type { ChatUploadPolicyRequest } from "@/lib/chat-message";
import { getRequestEnv } from "@/lib/runtime-env";
import { buildChatUploadPolicy } from "@/lib/server/chat-aliyun";

export const Route = createFileRoute("/api/chat-upload-policy")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        try {
          const env = getRequestEnv(context);
          const body = (await request.json()) as ChatUploadPolicyRequest;

          if (!body.conversationId) {
            return errorResponse("Missing required field: conversationId", 400);
          }
          if (!body.fileName) {
            return errorResponse("Missing required field: fileName", 400);
          }
          if (!body.contentType) {
            return errorResponse("Missing required field: contentType", 400);
          }
          if (typeof body.size !== "number") {
            return errorResponse("Missing required field: size", 400);
          }

          return jsonResponse(
            buildChatUploadPolicy(
              {
                conversationId: body.conversationId,
                fileName: body.fileName,
                contentType: body.contentType,
                size: body.size,
              },
              env,
            ),
          );
        } catch (error) {
          console.error("Chat upload policy error:", error);
          return errorResponse(
            error instanceof Error
              ? error.message
              : "Failed to build upload policy",
            500,
          );
        }
      },
    },
  },
});
