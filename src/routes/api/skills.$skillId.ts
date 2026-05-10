import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { getRequestEnv } from "@/lib/runtime-env";
import { getSkillById } from "@/lib/server/skill-loader";
import { buildSkillDocumentView, skillIdSchema } from "@/lib/skills";

export const Route = createFileRoute("/api/skills/$skillId")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async ({ params, context }) => {
        const parsedSkillId = skillIdSchema.safeParse(params.skillId);
        if (!parsedSkillId.success) {
          return errorResponse(
            parsedSkillId.error.issues[0]?.message || "Invalid skillId",
            400,
          );
        }

        try {
          const skill = await getSkillById(
            parsedSkillId.data,
            getRequestEnv(context),
          );
          if (!skill?.enabled) {
            return errorResponse("Skill not found", 404);
          }
          return jsonResponse(buildSkillDocumentView(skill));
        } catch (error) {
          console.error(`Error in /api/skills/${parsedSkillId.data}:`, error);
          return errorResponse(
            error instanceof Error ? error.message : "Failed to load skill",
            500,
          );
        }
      },
    },
  },
});
