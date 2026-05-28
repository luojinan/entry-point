import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { getRequestEnv } from "@/lib/runtime-env";
import { listSkillsSafely } from "@/lib/server/skill-loader";

export const Route = createFileRoute("/api/skills")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ request, context }) => {
        const env = getRequestEnv(context);
        const refresh =
          new URL(request.url).searchParams.get("refresh") === "1";

        return jsonResponse(
          await listSkillsSafely(env, {
            preferFresh: refresh,
            allowStaleOnError: refresh,
          }),
        );
      },
    },
  },
});
