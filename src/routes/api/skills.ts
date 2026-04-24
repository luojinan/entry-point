import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { listSkills } from "@/lib/server/skill-loader";

export const Route = createFileRoute("/api/skills")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      GET: async () => {
        try {
          const skills = await listSkills();
          return jsonResponse(skills);
        } catch (error) {
          console.error("Error in /api/skills:", error);
          return errorResponse(
            error instanceof Error ? error.message : "Failed to load skills",
            500,
          );
        }
      },
    },
  },
});
