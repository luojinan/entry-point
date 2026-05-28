import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { remoteFileMoveSchema } from "@/lib/remote-files";
import { getRequestEnv } from "@/lib/runtime-env";
import { moveRemotePath } from "@/lib/server/remote-files";
import { remoteFileErrorResponse } from "@/lib/server/remote-files-api";

export const Route = createFileRoute("/api/files/move")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        try {
          const parsed = remoteFileMoveSchema.parse(await request.json());
          return jsonResponse(
            await moveRemotePath(parsed, getRequestEnv(context)),
          );
        } catch (error) {
          return remoteFileErrorResponse(error);
        }
      },
    },
  },
});
