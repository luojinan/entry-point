import { errorResponse } from "@/lib/api-utils";
import { isRemoteFileError } from "@/lib/server/remote-files";

export function remoteFileInvalidInputResponse(message: string): Response {
  return errorResponse(message, 400);
}

export function remoteFileErrorResponse(error: unknown): Response {
  if (isRemoteFileError(error)) {
    return errorResponse(error.message, error.status);
  }

  const message =
    error instanceof Error ? error.message : "Remote file request failed";
  return errorResponse(message, 500);
}
