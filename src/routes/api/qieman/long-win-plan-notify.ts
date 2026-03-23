import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  handleCorsPreflightRequest,
  jsonResponse,
} from "@/lib/api-utils";
import { transform } from "@/lib/notify/long-win-im";
import { sendWecomNotification } from "@/lib/notify/wecom";

export const Route = createFileRoute("/api/qieman/long-win-plan-notify")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            prodCode?: string;
            webhookKey?: string;
          };

          if (!body.prodCode) {
            return errorResponse("Missing required field: prodCode", 400);
          }
          if (!body.webhookKey) {
            return errorResponse("Missing required field: webhookKey", 400);
          }

          // Fetch data from the long-win-plan API
          const planUrl = new URL(
            `/api/qieman/long-win-plan?prodCode=${encodeURIComponent(body.prodCode)}`,
            request.url,
          );
          const planRes = await fetch(planUrl.toString());

          if (!planRes.ok) {
            const errText = await planRes.text();
            return errorResponse(
              `Failed to fetch long-win-plan: ${planRes.status} - ${errText}`,
              planRes.status,
            );
          }

          const planData = await planRes.json();
          console.log(JSON.stringify(planData));

          // Transform to IM text
          const imText = transform(planData);
          console.log(imText, body.webhookKey);

          // Send text via wecom
          const result = await sendWecomNotification(body.webhookKey, imText);

          return jsonResponse(result);
        } catch (error) {
          console.error("Error in /api/qieman/long-win-plan-notify:", error);
          return errorResponse(
            error instanceof Error ? error.message : "Internal server error",
            500,
          );
        }
      },
    },
  },
});
