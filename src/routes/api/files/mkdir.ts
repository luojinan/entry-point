import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { remoteFileMkdirSchema } from "@/lib/remote-files";
import { getRequestEnv } from "@/lib/runtime-env";
import { createRemoteDirectory } from "@/lib/server/remote-files";
import { remoteFileErrorResponse } from "@/lib/server/remote-files-api";

export const Route = createFileRoute("/api/files/mkdir")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        try {
          const parsed = remoteFileMkdirSchema.parse(await request.json());
          return jsonResponse(
            await createRemoteDirectory(parsed, getRequestEnv(context)),
          );
        } catch (error) {
          return remoteFileErrorResponse(error);
        }
      },
    },
  },
});
