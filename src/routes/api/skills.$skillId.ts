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
          return errorResponse("Skill not found", 404);
        }

        return jsonResponse(buildSkillDocumentView(skill));
      },
    },
  },
});
