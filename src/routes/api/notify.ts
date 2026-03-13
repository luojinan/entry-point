import { createFileRoute } from "@tanstack/react-router";
import { sendWecomNotification } from "@/lib/notify/wecom";
import {
	jsonResponse,
	errorResponse,
	handleCorsPreflightRequest,
} from "@/lib/api-utils";

export const Route = createFileRoute("/api/notify")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

			POST: async ({ request }) => {
				try {
					const body = (await request.json()) as {
						channel?: string;
						webhookKey?: string;
						content?: string;
					};

					if (!body.channel) {
						return errorResponse("Missing required field: channel", 400);
					}
					if (!body.webhookKey) {
						return errorResponse("Missing required field: webhookKey", 400);
					}
					if (!body.content) {
						return errorResponse("Missing required field: content", 400);
					}

					if (body.channel !== "wecom") {
						return errorResponse(
							`Unsupported channel: ${body.channel}`,
							400,
						);
					}

					const result = await sendWecomNotification(
						body.webhookKey,
						body.content,
					);
					return jsonResponse(result);
				} catch (error) {
					console.error("Notify error:", error);
					return errorResponse(
						error instanceof Error ? error.message : "Internal server error",
						500,
					);
				}
			},
		},
	},
});
