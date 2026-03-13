import { createFileRoute } from "@tanstack/react-router";
import {
	jsonResponse,
	handleCorsPreflightRequest,
} from "@/lib/api-utils";

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

			GET: async () => {
				return jsonResponse({ status: "ok", timestamp: Date.now() });
			},
		},
	},
});
