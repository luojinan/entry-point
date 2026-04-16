import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import type { ChatSignedObjectUrlRequest } from "@/lib/chat-message";
import { signChatObjectUrl } from "@/lib/server/chat-aliyun";

export const Route = createFileRoute("/api/chat-object-url")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as ChatSignedObjectUrlRequest;

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
            signChatObjectUrl({
              bucket: body.bucket,
              region: body.region,
              objectKey: body.objectKey,
            }),
          );
        } catch (error) {
          console.error("Chat object URL error:", error);
          return errorResponse(
            error instanceof Error
              ? error.message
              : "Failed to sign object URL",
            500,
          );
        }
      },
    },
  },
});
