import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { remoteFileWriteSchema } from "@/lib/remote-files";
import { getRequestEnv } from "@/lib/runtime-env";
import { writeRemoteText } from "@/lib/server/remote-files";
import { remoteFileErrorResponse } from "@/lib/server/remote-files-api";

export const Route = createFileRoute("/api/files/write")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        try {
          const parsed = remoteFileWriteSchema.parse(await request.json());
          return jsonResponse(
            await writeRemoteText(parsed, getRequestEnv(context)),
          );
        } catch (error) {
          return remoteFileErrorResponse(error);
        }
      },
    },
  },
});
