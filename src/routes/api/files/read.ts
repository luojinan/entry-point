import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { remoteFileQueryPathSchema } from "@/lib/remote-files";
import { getRequestEnv } from "@/lib/runtime-env";
import { readRemoteText } from "@/lib/server/remote-files";
import { remoteFileErrorResponse } from "@/lib/server/remote-files-api";

export const Route = createFileRoute("/api/files/read")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ request, context }) => {
        try {
          const url = new URL(request.url);
          const parsed = remoteFileQueryPathSchema.parse({
            path: url.searchParams.get("path"),
          });
          return jsonResponse(
            await readRemoteText(parsed.path, getRequestEnv(context)),
          );
        } catch (error) {
          return remoteFileErrorResponse(error);
        }
      },
    },
  },
});
