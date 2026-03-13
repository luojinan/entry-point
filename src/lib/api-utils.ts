const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
} as const;

export function jsonResponse(
	data: unknown,
	status = 200,
	headers?: HeadersInit,
): Response {
	return new Response(
		JSON.stringify({
			code: 0,
			message: "success",
			data,
		}),
		{
			status,
			headers: {
				"Content-Type": "application/json",
				...CORS_HEADERS,
				...Object.fromEntries(
					headers instanceof Headers
						? headers.entries()
						: Array.isArray(headers)
							? headers
							: Object.entries(headers ?? {}),
				),
			},
		},
	);
}

export function errorResponse(
	message: string,
	status: number,
	code?: number,
): Response {
	return new Response(
		JSON.stringify({
			code: code ?? status,
			message,
		}),
		{
			status,
			headers: {
				"Content-Type": "application/json",
				...CORS_HEADERS,
			},
		},
	);
}

export function withCors(response: Response): Response {
	for (const [key, value] of Object.entries(CORS_HEADERS)) {
		response.headers.set(key, value);
	}
	return response;
}

export function handleCorsPreflightRequest(_request: Request): Response {
	return new Response(null, {
		status: 204,
		headers: CORS_HEADERS,
	});
}
