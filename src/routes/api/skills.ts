import { createFileRoute } from "@tanstack/react-router";

import { handleCorsPreflightRequest, jsonResponse } from "@/lib/api-utils";
import { getRequestEnv } from "@/lib/runtime-env";
import { listSkillsSafely } from "@/lib/server/skill-loader";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

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
          200,
          NO_STORE_HEADERS,
        );
      },
    },
  },
});
