import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { remoteFileDeleteSchema } from "@/lib/remote-files";
import { getRequestEnv } from "@/lib/runtime-env";
import { deleteRemotePath } from "@/lib/server/remote-files";
import { remoteFileErrorResponse } from "@/lib/server/remote-files-api";

export const Route = createFileRoute("/api/files/delete")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        try {
          const parsed = remoteFileDeleteSchema.parse(await request.json());
          return jsonResponse(
            await deleteRemotePath(parsed, getRequestEnv(context)),
          );
        } catch (error) {
          return remoteFileErrorResponse(error);
        }
      },
    },
  },
});
