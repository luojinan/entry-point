import { z } from "zod";

export const JIANGUOYUN_PATH_MAX_LENGTH = 1024;
export const JIANGUOYUN_TEXT_CONTENT_MAX_LENGTH = 500_000;

export const jianguoyunPathSchema = z
  .string()
  .trim()
  .min(1, "path is required")
  .max(JIANGUOYUN_PATH_MAX_LENGTH, "path is too long");

export const jianguoyunQueryPathSchema = z.object({
  path: jianguoyunPathSchema,
});

export const jianguoyunWriteSchema = z.object({
  path: jianguoyunPathSchema,
  content: z
    .string()
    .max(
      JIANGUOYUN_TEXT_CONTENT_MAX_LENGTH,
      "content exceeds the maximum length",
    ),
  overwrite: z.boolean().optional(),
  expectedEtag: z.string().trim().min(1).max(256).optional(),
  contentType: z.string().trim().min(1).max(128).optional(),
});

export const jianguoyunMoveSchema = z.object({
  from: jianguoyunPathSchema,
  to: jianguoyunPathSchema,
  overwrite: z.boolean().optional(),
});

export const jianguoyunDeleteSchema = z.object({
  path: jianguoyunPathSchema,
  recursive: z.boolean().optional(),
});

export const jianguoyunMkdirSchema = z.object({
  path: jianguoyunPathSchema,
});

export type JianguoyunQueryPathInput = z.infer<
  typeof jianguoyunQueryPathSchema
>;
export type JianguoyunWriteInput = z.infer<typeof jianguoyunWriteSchema>;
export type JianguoyunMoveInput = z.infer<typeof jianguoyunMoveSchema>;
export type JianguoyunDeleteInput = z.infer<typeof jianguoyunDeleteSchema>;
export type JianguoyunMkdirInput = z.infer<typeof jianguoyunMkdirSchema>;

export interface JianguoyunEntry {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
  etag?: string;
  updatedAt?: string;
  contentType?: string;
}

export interface JianguoyunListResult {
  requestId: string;
  path: string;
  entries: JianguoyunEntry[];
  truncated: boolean;
}

export interface JianguoyunStatResult {
  requestId: string;
  entry: JianguoyunEntry;
}

export interface JianguoyunReadResult {
  requestId: string;
  path: string;
  content: string;
  contentType: string;
  etag?: string;
  updatedAt?: string;
}

export interface JianguoyunWriteResult {
  requestId: string;
  path: string;
  bytesWritten: number;
  contentType: string;
  etag?: string;
  updatedAt?: string;
}

export interface JianguoyunMoveResult {
  requestId: string;
  from: string;
  to: string;
  entry?: JianguoyunEntry;
}

export interface JianguoyunDeleteResult {
  requestId: string;
  path: string;
  deleted: true;
}

export interface JianguoyunMkdirResult {
  requestId: string;
  path: string;
  created: true;
}
