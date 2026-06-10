import { createFileRoute } from "@tanstack/react-router";

import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { getRequestEnv } from "@/lib/runtime-env";
import { getSkillById } from "@/lib/server/skill-loader";
import { buildSkillDocumentView } from "@/lib/skills";
import { skillIdSchema } from "@/lib/skills";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

export const Route = createFileRoute("/api/skills/$skillId")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ request, params, context }) => {
        const parsedSkillId = skillIdSchema.safeParse(params.skillId);
        if (!parsedSkillId.success) {
          return errorResponse(
            parsedSkillId.error.issues[0]?.message || "Invalid skillId",
            400,
            undefined,
            NO_STORE_HEADERS,
          );
        }

        const refresh =
          new URL(request.url).searchParams.get("refresh") === "1";
        const skill = await getSkillById(
          parsedSkillId.data,
          getRequestEnv(context),
          {
            preferFresh: refresh,
            allowStaleOnError: refresh,
          },
        );
        if (!skill?.enabled) {
          return errorResponse(
            "Skill not found",
            404,
            undefined,
            NO_STORE_HEADERS,
          );
        }

        return jsonResponse(
          buildSkillDocumentView(skill),
          200,
          NO_STORE_HEADERS,
        );
      },
    },
  },
});
