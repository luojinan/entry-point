import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import type { ChatOCRRequest } from "@/lib/chat-message";
import { getRequestEnv } from "@/lib/runtime-env";
import { recognizeChatImage } from "@/lib/server/chat-aliyun";

export const Route = createFileRoute("/api/chat-ocr")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        try {
          const env = getRequestEnv(context);
          const body = (await request.json()) as ChatOCRRequest;

          if (!body.bucket) {
            return errorResponse("Missing required field: bucket", 400);
          }
          if (!body.region) {
            return errorResponse("Missing required field: region", 400);
          }
          if (!body.objectKey) {
            return errorResponse("Missing required field: objectKey", 400);
          }

          return jsonResponse(
            await recognizeChatImage(
              body.bucket,
              body.region,
              body.objectKey,
              env,
            ),
          );
        } catch (error) {
          console.error("Chat OCR error:", error);
          return errorResponse(
            error instanceof Error ? error.message : "Failed to process OCR",
            500,
          );
        }
      },
    },
  },
});
