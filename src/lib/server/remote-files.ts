import { posix as pathPosix } from "node:path";

import {
  type RemoteFileDeleteInput,
  type RemoteFileDeleteResult,
  type RemoteFileEntry,
  type RemoteFileListResult,
  type RemoteFileMkdirInput,
  type RemoteFileMkdirResult,
  type RemoteFileMoveInput,
  type RemoteFileMoveResult,
  type RemoteFileReadResult,
  type RemoteFileStatResult,
  type RemoteFileWriteInput,
  type RemoteFileWriteResult,
} from "@/lib/remote-files";
import type { RuntimeEnv } from "@/lib/runtime-env";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export type RemoteFileErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "NOT_TEXT_FILE"
  | "FILE_TOO_LARGE"
  | "UPSTREAM_ERROR"
  | "CONFLICT"
  | "DIRECTORY_NOT_EMPTY";

interface SkillFileRow {
  path: string;
  name: string;
  parent_path: string | null;
  is_dir: boolean;
  content: string | null;
  content_type: string | null;
  size_bytes: number;
  etag: string;
  created_at: string;
  updated_at: string;
}

const TABLE_NAME = "skill_files";
const MAX_TEXT_FILE_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_LIST_ENTRIES = 200;
const DEFAULT_TEXT_CONTENT_TYPE = "text/markdown; charset=utf-8";

export class RemoteFileError extends Error {
  readonly name = "RemoteFileError";

  constructor(
    readonly code: RemoteFileErrorCode,
    readonly status: number,
    readonly requestId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function isRemoteFileError(error: unknown): error is RemoteFileError {
  return error instanceof RemoteFileError;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

function createError(
  code: RemoteFileErrorCode,
  status: number,
  requestId: string,
  message: string,
  cause?: unknown,
): RemoteFileError {
  return new RemoteFileError(code, status, requestId, message, cause);
}

function normalizePathValue(
  value: string,
  options?: { allowRoot?: boolean },
): string {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new Error("Path cannot be empty");
  }
  if (trimmed.includes("\0")) {
    throw new Error("Path contains invalid characters");
  }

  const rawSegments = trimmed.split("/");
  if (rawSegments.some((segment) => segment === "..")) {
    throw new Error("Path cannot contain '..'");
  }

  const normalized = pathPosix.normalize(
    trimmed.startsWith("/") ? trimmed : `/${trimmed}`,
  );
  const collapsed =
    normalized === "/." ? "/" : normalized.replace(/\/{2,}/g, "/");
  const finalPath = collapsed === "/" ? "/" : collapsed.replace(/\/+$/, "");

  if (!options?.allowRoot && finalPath === "/") {
    throw new Error("Path cannot be the root directory");
  }

  if (!finalPath.startsWith("/")) {
    throw new Error("Path must stay within the configured root");
  }

  return finalPath;
}

function normalizeUserPath(
  value: string,
  requestId: string,
  options?: { allowRoot?: boolean },
): string {
  try {
    return normalizePathValue(value, options);
  } catch (error) {
    throw createError(
      "INVALID_PATH",
      400,
      requestId,
      error instanceof Error ? error.message : "Invalid path",
      error,
    );
  }
}

function getName(path: string): string {
  if (path === "/") {
    return "";
  }
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function getParentPath(path: string): string | null {
  if (path === "/") {
    return null;
  }
  const parent = pathPosix.dirname(path);
  return parent === "." ? "/" : parent;
}

function getByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function createEtag(): string {
  return crypto.randomUUID();
}

function rowToEntry(row: SkillFileRow): RemoteFileEntry {
  return {
    path: row.path,
    name: row.name,
    isDir: row.is_dir,
    size: row.is_dir ? undefined : row.size_bytes,
    etag: row.etag,
    updatedAt: row.updated_at,
    contentType: row.content_type ?? undefined,
  };
}

function rootEntry(requestId: string): RemoteFileStatResult {
  return {
    requestId,
    entry: {
      path: "/",
      name: "",
      isDir: true,
      updatedAt: undefined,
    },
  };
}

async function getRow(
  path: string,
  env: RuntimeEnv,
): Promise<SkillFileRow | null> {
  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("path", path)
    .maybeSingle<SkillFileRow>();

  if (error) {
    throw error;
  }
  return data;
}

async function assertParentDirectory(
  path: string,
  env: RuntimeEnv,
  requestId: string,
) {
  const parentPath = getParentPath(path);
  if (!parentPath || parentPath === "/") {
    return;
  }

  const parent = await getRow(parentPath, env);
  if (!parent) {
    throw createError(
      "NOT_FOUND",
      404,
      requestId,
      `Parent directory "${parentPath}" does not exist`,
    );
  }
  if (!parent.is_dir) {
    throw createError(
      "CONFLICT",
      409,
      requestId,
      `Parent path "${parentPath}" is not a directory`,
    );
  }
}

export async function listRemoteFiles(
  path: string,
  env?: RuntimeEnv,
): Promise<RemoteFileListResult> {
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(path, requestId, {
    allowRoot: true,
  });

  if (normalizedPath !== "/") {
    const row = await getRow(normalizedPath, env);
    if (!row) {
      throw createError(
        "NOT_FOUND",
        404,
        requestId,
        `Path "${normalizedPath}" does not exist`,
      );
    }
    if (!row.is_dir) {
      throw createError(
        "CONFLICT",
        409,
        requestId,
        `Path "${normalizedPath}" is not a directory`,
      );
    }
  }

  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("parent_path", normalizedPath)
    .order("is_dir", { ascending: false })
    .order("name", { ascending: true })
    .limit(MAX_LIST_ENTRIES + 1)
    .returns<SkillFileRow[]>();

  if (error) {
    throw createError("UPSTREAM_ERROR", 502, requestId, error.message, error);
  }

  const rows = data ?? [];
  return {
    requestId,
    path: normalizedPath,
    entries: rows.slice(0, MAX_LIST_ENTRIES).map(rowToEntry),
    truncated: rows.length > MAX_LIST_ENTRIES,
  };
}

export async function statRemotePath(
  path: string,
  env?: RuntimeEnv,
): Promise<RemoteFileStatResult> {
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(path, requestId, {
    allowRoot: true,
  });

  if (normalizedPath === "/") {
    return rootEntry(requestId);
  }

  const row = await getRow(normalizedPath, env);
  if (!row) {
    throw createError(
      "NOT_FOUND",
      404,
      requestId,
      `Path "${normalizedPath}" does not exist`,
    );
  }

  return {
    requestId,
    entry: rowToEntry(row),
  };
}

export async function readRemoteText(
  path: string,
  env?: RuntimeEnv,
): Promise<RemoteFileReadResult> {
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(path, requestId);
  const row = await getRow(normalizedPath, env);

  if (!row) {
    throw createError(
      "NOT_FOUND",
      404,
      requestId,
      `Path "${normalizedPath}" does not exist`,
    );
  }
  if (row.is_dir) {
    throw createError(
      "NOT_TEXT_FILE",
      415,
      requestId,
      `Path "${normalizedPath}" is a directory`,
    );
  }
  if (row.size_bytes > MAX_TEXT_FILE_BYTES) {
    throw createError(
      "FILE_TOO_LARGE",
      413,
      requestId,
      `File "${normalizedPath}" is too large to read as text`,
    );
  }

  return {
    requestId,
    path: normalizedPath,
    content: row.content ?? "",
    contentType: row.content_type ?? DEFAULT_TEXT_CONTENT_TYPE,
    etag: row.etag,
    updatedAt: row.updated_at,
  };
}

export async function writeRemoteText(
  input: RemoteFileWriteInput,
  env?: RuntimeEnv,
): Promise<RemoteFileWriteResult> {
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(input.path, requestId);
  const sizeBytes = getByteLength(input.content);

  if (sizeBytes > MAX_WRITE_BYTES) {
    throw createError(
      "FILE_TOO_LARGE",
      413,
      requestId,
      `Content for "${normalizedPath}" is too large`,
    );
  }

  await assertParentDirectory(normalizedPath, env, requestId);

  const existing = await getRow(normalizedPath, env);
  if (existing?.is_dir) {
    throw createError(
      "CONFLICT",
      409,
      requestId,
      `Path "${normalizedPath}" is a directory`,
    );
  }
  if (existing && input.overwrite === false) {
    throw createError(
      "ALREADY_EXISTS",
      409,
      requestId,
      `Path "${normalizedPath}" already exists`,
    );
  }
  if (existing && input.expectedEtag && existing.etag !== input.expectedEtag) {
    throw createError(
      "CONFLICT",
      409,
      requestId,
      `Path "${normalizedPath}" has changed`,
    );
  }

  const now = new Date().toISOString();
  const payload = {
    path: normalizedPath,
    name: getName(normalizedPath),
    parent_path: getParentPath(normalizedPath),
    is_dir: false,
    content: input.content,
    content_type: input.contentType ?? DEFAULT_TEXT_CONTENT_TYPE,
    size_bytes: sizeBytes,
    etag: createEtag(),
    updated_at: now,
  };

  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: "path" })
    .select("*")
    .single<SkillFileRow>();

  if (error) {
    throw createError("UPSTREAM_ERROR", 502, requestId, error.message, error);
  }

  return {
    requestId,
    path: normalizedPath,
    bytesWritten: data.size_bytes,
    contentType: data.content_type ?? DEFAULT_TEXT_CONTENT_TYPE,
    etag: data.etag,
    updatedAt: data.updated_at,
  };
}

export async function createRemoteDirectory(
  input: RemoteFileMkdirInput,
  env?: RuntimeEnv,
): Promise<RemoteFileMkdirResult> {
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(input.path, requestId);
  await assertParentDirectory(normalizedPath, env, requestId);

  const existing = await getRow(normalizedPath, env);
  if (existing) {
    if (existing.is_dir) {
      return {
        requestId,
        path: normalizedPath,
        created: true,
      };
    }
    throw createError(
      "ALREADY_EXISTS",
      409,
      requestId,
      `Path "${normalizedPath}" already exists`,
    );
  }

  const supabase = createSupabaseServerClient(env);
  const { error } = await supabase.from(TABLE_NAME).insert({
    path: normalizedPath,
    name: getName(normalizedPath),
    parent_path: getParentPath(normalizedPath),
    is_dir: true,
    content: null,
    content_type: null,
    size_bytes: 0,
    etag: createEtag(),
  });

  if (error) {
    throw createError("UPSTREAM_ERROR", 502, requestId, error.message, error);
  }

  return {
    requestId,
    path: normalizedPath,
    created: true,
  };
}

async function listDescendantRows(
  path: string,
  env: RuntimeEnv,
): Promise<SkillFileRow[]> {
  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .like("path", `${path}/%`)
    .order("path", { ascending: true })
    .returns<SkillFileRow[]>();

  if (error) {
    throw error;
  }
  return data ?? [];
}

export async function moveRemotePath(
  input: RemoteFileMoveInput,
  env?: RuntimeEnv,
): Promise<RemoteFileMoveResult> {
  const requestId = createRequestId();
  const from = normalizeUserPath(input.from, requestId);
  const to = normalizeUserPath(input.to, requestId);

  if (from === to) {
    const entry = (await statRemotePath(from, env)).entry;
    return { requestId, from, to, entry };
  }
  if (to.startsWith(`${from}/`)) {
    throw createError(
      "CONFLICT",
      409,
      requestId,
      "Cannot move a directory into itself",
    );
  }

  const source = await getRow(from, env);
  if (!source) {
    throw createError("NOT_FOUND", 404, requestId, `Path "${from}" not found`);
  }
  await assertParentDirectory(to, env, requestId);

  const target = await getRow(to, env);
  if (target) {
    if (!input.overwrite) {
      throw createError(
        "ALREADY_EXISTS",
        409,
        requestId,
        `Path "${to}" already exists`,
      );
    }
    await deleteRemotePath({ path: to, recursive: true }, env);
  }

  const supabase = createSupabaseServerClient(env);
  const now = new Date().toISOString();

  if (!source.is_dir) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .update({
        path: to,
        name: getName(to),
        parent_path: getParentPath(to),
        etag: createEtag(),
        updated_at: now,
      })
      .eq("path", from)
      .select("*")
      .single<SkillFileRow>();

    if (error) {
      throw createError("UPSTREAM_ERROR", 502, requestId, error.message, error);
    }
    return { requestId, from, to, entry: rowToEntry(data) };
  }

  const descendants = await listDescendantRows(from, env);
  const rows = [source, ...descendants].sort(
    (left, right) => right.path.length - left.path.length,
  );

  for (const row of rows) {
    const nextPath =
      row.path === from ? to : `${to}${row.path.slice(from.length)}`;
    const { error } = await supabase
      .from(TABLE_NAME)
      .update({
        path: nextPath,
        name: getName(nextPath),
        parent_path: getParentPath(nextPath),
        etag: createEtag(),
        updated_at: now,
      })
      .eq("path", row.path);

    if (error) {
      throw createError("UPSTREAM_ERROR", 502, requestId, error.message, error);
    }
  }

  const moved = await getRow(to, env);
  return {
    requestId,
    from,
    to,
    entry: moved ? rowToEntry(moved) : undefined,
  };
}

export async function deleteRemotePath(
  input: RemoteFileDeleteInput,
  env?: RuntimeEnv,
): Promise<RemoteFileDeleteResult> {
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(input.path, requestId);
  const row = await getRow(normalizedPath, env);
  if (!row) {
    throw createError(
      "NOT_FOUND",
      404,
      requestId,
      `Path "${normalizedPath}" does not exist`,
    );
  }

  const supabase = createSupabaseServerClient(env);
  if (row.is_dir) {
    const descendants = await listDescendantRows(normalizedPath, env);
    if (descendants.length > 0 && !input.recursive) {
      throw createError(
        "DIRECTORY_NOT_EMPTY",
        409,
        requestId,
        `Directory "${normalizedPath}" is not empty`,
      );
    }

    const rows = [row, ...descendants].sort(
      (left, right) => right.path.length - left.path.length,
    );
    for (const item of rows) {
      const { error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq("path", item.path);
      if (error) {
        throw createError(
          "UPSTREAM_ERROR",
          502,
          requestId,
          error.message,
          error,
        );
      }
    }
  } else {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq("path", normalizedPath);
    if (error) {
      throw createError("UPSTREAM_ERROR", 502, requestId, error.message, error);
    }
  }

  return {
    requestId,
    path: normalizedPath,
    deleted: true,
  };
}
