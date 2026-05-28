import { z } from "zod";

export const REMOTE_FILE_PATH_MAX_LENGTH = 1024;
export const REMOTE_FILE_TEXT_CONTENT_MAX_LENGTH = 500_000;

export const REMOTE_FILE_TOOL_NAMES = [
  "listRemoteFiles",
  "statRemotePath",
  "readRemoteFile",
  "writeRemoteFile",
  "moveRemotePath",
  "deleteRemotePath",
  "createRemoteDirectory",
] as const;

export type RemoteFileToolName = (typeof REMOTE_FILE_TOOL_NAMES)[number];

export const remoteFilePathSchema = z
  .string()
  .trim()
  .min(1, "path is required")
  .max(REMOTE_FILE_PATH_MAX_LENGTH, "path is too long");

export const remoteFileQueryPathSchema = z.object({
  path: remoteFilePathSchema,
});

export const remoteFileWriteSchema = z.object({
  path: remoteFilePathSchema,
  content: z
    .string()
    .max(
      REMOTE_FILE_TEXT_CONTENT_MAX_LENGTH,
      "content exceeds the maximum length",
    ),
  overwrite: z.boolean().optional(),
  expectedEtag: z.string().trim().min(1).max(256).optional(),
  contentType: z.string().trim().min(1).max(128).optional(),
});

export const remoteFileMoveSchema = z.object({
  from: remoteFilePathSchema,
  to: remoteFilePathSchema,
  overwrite: z.boolean().optional(),
});

export const remoteFileDeleteSchema = z.object({
  path: remoteFilePathSchema,
  recursive: z.boolean().optional(),
});

export const remoteFileMkdirSchema = z.object({
  path: remoteFilePathSchema,
});

export type RemoteFileQueryPathInput = z.infer<
  typeof remoteFileQueryPathSchema
>;
export type RemoteFileWriteInput = z.infer<typeof remoteFileWriteSchema>;
export type RemoteFileMoveInput = z.infer<typeof remoteFileMoveSchema>;
export type RemoteFileDeleteInput = z.infer<typeof remoteFileDeleteSchema>;
export type RemoteFileMkdirInput = z.infer<typeof remoteFileMkdirSchema>;

export interface RemoteFileEntry {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
  etag?: string;
  updatedAt?: string;
  contentType?: string;
}

export interface RemoteFileListResult {
  requestId: string;
  path: string;
  entries: RemoteFileEntry[];
  truncated: boolean;
}

export interface RemoteFileStatResult {
  requestId: string;
  entry: RemoteFileEntry;
}

export interface RemoteFileReadResult {
  requestId: string;
  path: string;
  content: string;
  contentType: string;
  etag?: string;
  updatedAt?: string;
}

export interface RemoteFileWriteResult {
  requestId: string;
  path: string;
  bytesWritten: number;
  contentType: string;
  etag?: string;
  updatedAt?: string;
}

export interface RemoteFileMoveResult {
  requestId: string;
  from: string;
  to: string;
  entry?: RemoteFileEntry;
}

export interface RemoteFileDeleteResult {
  requestId: string;
  path: string;
  deleted: true;
}

export interface RemoteFileMkdirResult {
  requestId: string;
  path: string;
  created: true;
}
