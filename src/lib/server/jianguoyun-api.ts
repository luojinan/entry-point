import { errorResponse } from "@/lib/api-utils";
import { isJianguoyunError } from "@/lib/server/jianguoyun";

export function jianguoyunInvalidInputResponse(message: string): Response {
  return errorResponse(message, 400);
}

export function jianguoyunErrorResponse(
  error: unknown,
  fallbackMessage: string,
): Response {
  if (isJianguoyunError(error)) {
    return errorResponse(error.message, error.status, undefined, {
      "X-Request-Id": error.requestId,
    });
  }

  return errorResponse(
    error instanceof Error ? error.message : fallbackMessage,
    500,
  );
}
