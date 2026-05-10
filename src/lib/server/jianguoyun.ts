import { Buffer } from "node:buffer";
import { posix as pathPosix } from "node:path";
import { type CheerioAPI, type Element, load } from "cheerio";
import type {
  JianguoyunDeleteInput,
  JianguoyunDeleteResult,
  JianguoyunEntry,
  JianguoyunListResult,
  JianguoyunMkdirInput,
  JianguoyunMkdirResult,
  JianguoyunMoveInput,
  JianguoyunMoveResult,
  JianguoyunReadResult,
  JianguoyunStatResult,
  JianguoyunWriteInput,
  JianguoyunWriteResult,
} from "@/lib/jianguoyun";
import {
  getRequiredRuntimeEnvValue,
  getRuntimeEnvValue,
  type RuntimeEnv,
} from "@/lib/runtime-env";

export type JianguoyunErrorCode =
  | "INVALID_PATH"
  | "PATH_OUT_OF_ROOT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "NOT_TEXT_FILE"
  | "FILE_TOO_LARGE"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "CONFLICT"
  | "DIRECTORY_NOT_EMPTY";

interface JianguoyunConfig {
  baseUrl: string;
  basePathname: string;
  username: string;
  password: string;
  rootPath: string;
  forbiddenPathPrefixes: string[];
  maxTextFileBytes: number;
  maxWriteBytes: number;
  maxListEntries: number;
  timeoutMs: number;
}

interface DavFetchOptions {
  headers?: HeadersInit;
  body?: BodyInit;
  expectedStatuses?: number[];
}

interface DavPropfindEntry extends JianguoyunEntry {
  href: string;
}

const DEFAULT_JIANGUOYUN_BASE_URL = "https://dav.jianguoyun.com/dav/";
const DEFAULT_JIANGUOYUN_ROOT_PATH = "/llm-fs";
const FORBIDDEN_PATH_PREFIXES = ["/system", "/private"];
const MAX_TEXT_FILE_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;
const MAX_LIST_ENTRIES = 200;
const TIMEOUT_MS = 15_000;
const TEXT_LIKE_EXTENSIONS = new Set([
  ".conf",
  ".csv",
  ".css",
  ".env",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_MIME_HINTS = [
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/typescript",
  "application/x-javascript",
  "application/x-ndjson",
  "application/xml",
  "image/svg+xml",
  "text/",
];
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:getcontentlength />
    <d:getcontenttype />
    <d:getetag />
    <d:getlastmodified />
    <d:resourcetype />
  </d:prop>
</d:propfind>`;

export class JianguoyunError extends Error {
  readonly name = "JianguoyunError";

  constructor(
    readonly code: JianguoyunErrorCode,
    readonly status: number,
    readonly requestId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function isJianguoyunError(error: unknown): error is JianguoyunError {
  return error instanceof JianguoyunError;
}

function getRequiredEnv(name: string, env?: RuntimeEnv): string {
  return getRequiredRuntimeEnvValue(env, name);
}

function normalizeRootPath(path: string): string {
  const normalized = normalizePathValue(path, { allowRoot: false });
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function getConfig(env?: RuntimeEnv): JianguoyunConfig {
  const baseUrlValue =
    getRuntimeEnvValue(env, "JIANGUOYUN_BASE_URL") ||
    DEFAULT_JIANGUOYUN_BASE_URL;
  const baseUrl = new URL(baseUrlValue);

  return {
    baseUrl: baseUrl.toString(),
    basePathname: baseUrl.pathname.replace(/\/$/, ""),
    username: getRequiredEnv("JIANGUOYUN_USERNAME", env),
    password: getRequiredEnv("JIANGUOYUN_PASSWORD", env),
    rootPath: normalizeRootPath(
      getRuntimeEnvValue(env, "JIANGUOYUN_ROOT_PATH") ||
        DEFAULT_JIANGUOYUN_ROOT_PATH,
    ),
    forbiddenPathPrefixes: FORBIDDEN_PATH_PREFIXES,
    maxTextFileBytes: MAX_TEXT_FILE_BYTES,
    maxWriteBytes: MAX_WRITE_BYTES,
    maxListEntries: MAX_LIST_ENTRIES,
    timeoutMs: TIMEOUT_MS,
  };
}

function createRequestId(): string {
  return crypto.randomUUID();
}

function createError(
  code: JianguoyunErrorCode,
  status: number,
  requestId: string,
  message: string,
  cause?: unknown,
): JianguoyunError {
  return new JianguoyunError(code, status, requestId, message, cause);
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

function assertPathAllowed(
  normalizedPath: string,
  config: JianguoyunConfig,
  requestId: string,
) {
  for (const prefix of config.forbiddenPathPrefixes) {
    if (
      normalizedPath === prefix ||
      normalizedPath.startsWith(`${prefix === "/" ? "" : prefix}/`)
    ) {
      throw createError(
        "PATH_OUT_OF_ROOT",
        403,
        requestId,
        `Path "${normalizedPath}" is not allowed`,
      );
    }
  }
}

function resolveRemotePath(
  normalizedPath: string,
  config: JianguoyunConfig,
): string {
  return normalizedPath === "/"
    ? config.rootPath
    : `${config.rootPath}${normalizedPath}`;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildRemoteUrl(path: string, config: JianguoyunConfig): string {
  const url = new URL(config.baseUrl);
  url.pathname = `${config.basePathname}${encodePathSegments(path)}`;
  url.search = "";
  return url.toString();
}

function decodeHrefToUserPath(
  href: string,
  config: JianguoyunConfig,
): string | null {
  const parsed = new URL(href, config.baseUrl);
  const pathname = parsed.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
  if (!pathname.startsWith(config.basePathname)) {
    return null;
  }

  const remotePath = pathname.slice(config.basePathname.length) || "/";
  if (
    remotePath !== config.rootPath &&
    !remotePath.startsWith(`${config.rootPath}/`)
  ) {
    return null;
  }

  const userPath = remotePath.slice(config.rootPath.length) || "/";
  try {
    return normalizePathValue(userPath, { allowRoot: true });
  } catch {
    return null;
  }
}

function basicAuthHeader(config: JianguoyunConfig): string {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
}

function isTextMimeType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const normalized = contentType.toLowerCase().split(";")[0]?.trim();
  if (!normalized) {
    return false;
  }

  return TEXT_MIME_HINTS.some((hint) =>
    hint.endsWith("/")
      ? normalized.startsWith(hint)
      : normalized === hint || normalized.endsWith(`+${hint.split("/")[1]}`),
  );
}

function inferContentTypeFromPath(path: string): string {
  const extension = pathPosix.extname(path).toLowerCase();

  switch (extension) {
    case ".json":
    case ".jsonl":
      return "application/json; charset=utf-8";
    case ".md":
    case ".mdx":
      return "text/markdown; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".csv":
    case ".tsv":
      return "text/csv; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".yaml":
    case ".yml":
      return "application/yaml; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function isTextPath(path: string): boolean {
  return TEXT_LIKE_EXTENSIONS.has(pathPosix.extname(path).toLowerCase());
}

function getNodeText(
  $: CheerioAPI,
  scope: Element,
  localName: string,
): string | undefined {
  const value = $(scope).find(localName).first().text().trim();
  return value || undefined;
}

function parseIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parsePropfindEntries(
  xmlText: string,
  config: JianguoyunConfig,
): DavPropfindEntry[] {
  const normalizedXml = xmlText.replace(
    /<(\/?)(?:[A-Za-z_][A-Za-z0-9_.-]*:)([A-Za-z_][A-Za-z0-9_.-]*)/g,
    "<$1$2",
  );
  const $ = load(normalizedXml, { xmlMode: true });
  if ($("parsererror").length > 0) {
    throw new Error("Failed to parse WebDAV XML response");
  }

  const responses = $("response").toArray();
  const entries: DavPropfindEntry[] = [];

  for (const response of responses) {
    const href = getNodeText($, response, "href");
    if (!href) {
      continue;
    }

    const userPath = decodeHrefToUserPath(href, config);
    if (!userPath) {
      continue;
    }

    const propstats = $(response).find("propstat").toArray();
    const successPropstat = propstats.find((propstat) => {
      const statusText = getNodeText($, propstat, "status");
      return (
        statusText?.includes(" 200 ") || statusText?.endsWith(" 200") || false
      );
    });

    if (!successPropstat) {
      continue;
    }

    const prop = $(successPropstat).find("prop").first();
    if (prop.length === 0) {
      continue;
    }

    const isDir = prop.find("resourcetype > collection").length > 0;
    const size = Number.parseInt(
      getNodeText($, prop.get(0), "getcontentlength") || "",
      10,
    );
    const pathName = userPath === "/" ? "/" : pathPosix.basename(userPath);

    entries.push({
      href,
      path: userPath,
      name: getNodeText($, prop.get(0), "displayname") || pathName,
      isDir,
      size: Number.isFinite(size) ? size : undefined,
      etag: getNodeText($, prop.get(0), "getetag"),
      updatedAt: parseIsoDate(getNodeText($, prop.get(0), "getlastmodified")),
      contentType: getNodeText($, prop.get(0), "getcontenttype"),
    });
  }

  return entries.sort((left, right) => {
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function readErrorMessage(
  response: Response,
): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

function mapDavStatusToError(
  status: number,
  requestId: string,
  fallbackMessage: string,
  responseMessage?: string,
): JianguoyunError {
  const message = responseMessage
    ? `${fallbackMessage}: ${responseMessage.slice(0, 240)}`
    : fallbackMessage;

  if (status === 404) {
    return createError("NOT_FOUND", 404, requestId, message);
  }
  if (status === 409) {
    return createError("CONFLICT", 409, requestId, message);
  }
  if (status === 412) {
    return createError("CONFLICT", 409, requestId, message);
  }
  if (status === 413) {
    return createError("FILE_TOO_LARGE", 413, requestId, message);
  }
  if (status === 429) {
    return createError("RATE_LIMITED", 429, requestId, message);
  }
  if (status >= 500) {
    return createError("UPSTREAM_ERROR", 502, requestId, message);
  }

  return createError("UPSTREAM_ERROR", 502, requestId, message);
}

async function fetchDav(
  requestId: string,
  config: JianguoyunConfig,
  method: string,
  remotePath: string,
  options?: DavFetchOptions,
): Promise<Response> {
  const url = buildRemoteUrl(remotePath, config);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(config),
        ...options?.headers,
      },
      body: options?.body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (
      options?.expectedStatuses?.length &&
      !options.expectedStatuses.includes(response.status)
    ) {
      const message = await readErrorMessage(response);
      throw mapDavStatusToError(
        response.status,
        requestId,
        `${method} ${remotePath} failed`,
        message,
      );
    }

    return response;
  } catch (error) {
    if (isJianguoyunError(error)) {
      throw error;
    }

    if (error instanceof Error && error.name === "TimeoutError") {
      throw createError(
        "UPSTREAM_TIMEOUT",
        504,
        requestId,
        `Request to Jianguoyun timed out while ${method} ${remotePath}`,
        error,
      );
    }

    throw createError(
      "UPSTREAM_ERROR",
      502,
      requestId,
      `Failed to reach Jianguoyun while ${method} ${remotePath}`,
      error,
    );
  }
}

async function statInternal(
  normalizedPath: string,
  config: JianguoyunConfig,
  requestId: string,
): Promise<JianguoyunEntry> {
  const response = await fetchDav(
    requestId,
    config,
    "PROPFIND",
    resolveRemotePath(normalizedPath, config),
    {
      headers: {
        Depth: "0",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: PROPFIND_BODY,
      expectedStatuses: [207],
    },
  );
  const entries = parsePropfindEntries(await response.text(), config);
  const entry = entries.find((item) => item.path === normalizedPath);

  if (!entry) {
    throw createError(
      "NOT_FOUND",
      404,
      requestId,
      `Path "${normalizedPath}" was not found`,
    );
  }

  const { href: _href, ...result } = entry;
  return result;
}

function assertTextFile(entry: JianguoyunEntry, requestId: string) {
  if (entry.isDir) {
    throw createError(
      "INVALID_PATH",
      400,
      requestId,
      `Path "${entry.path}" is a directory`,
    );
  }

  if (!isTextMimeType(entry.contentType) && !isTextPath(entry.path)) {
    throw createError(
      "NOT_TEXT_FILE",
      415,
      requestId,
      `Path "${entry.path}" is not a supported text file`,
    );
  }
}

function assertWritablePath(path: string, requestId: string) {
  if (path === "/") {
    throw createError(
      "INVALID_PATH",
      400,
      requestId,
      "The root directory cannot be modified",
    );
  }
}

async function enrichStatResult(
  normalizedPath: string,
  config: JianguoyunConfig,
  requestId: string,
): Promise<JianguoyunStatResult> {
  return {
    requestId,
    entry: await statInternal(normalizedPath, config, requestId),
  };
}

async function listInternal(
  normalizedPath: string,
  config: JianguoyunConfig,
  requestId: string,
): Promise<JianguoyunListResult> {
  const response = await fetchDav(
    requestId,
    config,
    "PROPFIND",
    resolveRemotePath(normalizedPath, config),
    {
      headers: {
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: PROPFIND_BODY,
      expectedStatuses: [207],
    },
  );
  const parsedEntries = parsePropfindEntries(await response.text(), config);
  const selfEntry = parsedEntries.find(
    (entry) => entry.path === normalizedPath,
  );

  if (!selfEntry) {
    throw createError(
      "NOT_FOUND",
      404,
      requestId,
      `Path "${normalizedPath}" was not found`,
    );
  }

  if (!selfEntry.isDir) {
    throw createError(
      "INVALID_PATH",
      400,
      requestId,
      `Path "${normalizedPath}" is not a directory`,
    );
  }

  const entries = parsedEntries.filter(
    (entry) => entry.path !== normalizedPath,
  );
  const truncated = entries.length > config.maxListEntries;

  return {
    requestId,
    path: normalizedPath,
    entries: entries
      .slice(0, config.maxListEntries)
      .map(({ href: _href, ...entry }) => entry),
    truncated,
  };
}

export async function listJianguoyunPath(
  path: string,
  env?: RuntimeEnv,
): Promise<JianguoyunListResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(path, requestId, {
    allowRoot: true,
  });
  assertPathAllowed(normalizedPath, config, requestId);
  return listInternal(normalizedPath, config, requestId);
}

export async function statJianguoyunPath(
  path: string,
  env?: RuntimeEnv,
): Promise<JianguoyunStatResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(path, requestId, {
    allowRoot: true,
  });
  assertPathAllowed(normalizedPath, config, requestId);
  return enrichStatResult(normalizedPath, config, requestId);
}

export async function readJianguoyunText(
  path: string,
  env?: RuntimeEnv,
): Promise<JianguoyunReadResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(path, requestId);
  assertPathAllowed(normalizedPath, config, requestId);

  const entry = await statInternal(normalizedPath, config, requestId);
  assertTextFile(entry, requestId);

  if (typeof entry.size === "number" && entry.size > config.maxTextFileBytes) {
    throw createError(
      "FILE_TOO_LARGE",
      413,
      requestId,
      `File "${normalizedPath}" exceeds the text size limit`,
    );
  }

  const response = await fetchDav(
    requestId,
    config,
    "GET",
    resolveRemotePath(normalizedPath, config),
    {
      expectedStatuses: [200],
    },
  );
  const contentLength = Number.parseInt(
    response.headers.get("content-length") || "",
    10,
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > config.maxTextFileBytes
  ) {
    throw createError(
      "FILE_TOO_LARGE",
      413,
      requestId,
      `File "${normalizedPath}" exceeds the text size limit`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > config.maxTextFileBytes) {
    throw createError(
      "FILE_TOO_LARGE",
      413,
      requestId,
      `File "${normalizedPath}" exceeds the text size limit`,
    );
  }

  return {
    requestId,
    path: normalizedPath,
    content: new TextDecoder("utf-8").decode(bytes),
    contentType:
      response.headers.get("content-type") || entry.contentType || "text/plain",
    etag: response.headers.get("etag") || entry.etag,
    updatedAt: entry.updatedAt,
  };
}

export async function writeJianguoyunText(
  input: JianguoyunWriteInput,
  env?: RuntimeEnv,
): Promise<JianguoyunWriteResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(input.path, requestId);
  assertPathAllowed(normalizedPath, config, requestId);
  assertWritablePath(normalizedPath, requestId);

  if (input.expectedEtag && input.overwrite === false) {
    throw createError(
      "CONFLICT",
      409,
      requestId,
      "expectedEtag cannot be combined with overwrite=false",
    );
  }

  const bytes = new TextEncoder().encode(input.content);
  if (bytes.byteLength > config.maxWriteBytes) {
    throw createError(
      "FILE_TOO_LARGE",
      413,
      requestId,
      `Content for "${normalizedPath}" exceeds the write limit`,
    );
  }

  const contentType =
    input.contentType?.trim() || inferContentTypeFromPath(normalizedPath);
  if (!isTextMimeType(contentType) && !isTextPath(normalizedPath)) {
    throw createError(
      "NOT_TEXT_FILE",
      415,
      requestId,
      `Path "${normalizedPath}" is not a supported text file`,
    );
  }

  try {
    await fetchDav(
      requestId,
      config,
      "PUT",
      resolveRemotePath(normalizedPath, config),
      {
        headers: {
          "Content-Type": contentType,
          ...(input.overwrite === false ? { "If-None-Match": "*" } : {}),
          ...(input.expectedEtag ? { "If-Match": input.expectedEtag } : {}),
        },
        body: bytes,
        expectedStatuses: [200, 201, 204],
      },
    );
  } catch (error) {
    if (isJianguoyunError(error) && error.code === "CONFLICT") {
      if (input.overwrite === false) {
        throw createError(
          "ALREADY_EXISTS",
          409,
          requestId,
          `Path "${normalizedPath}" already exists`,
          error,
        );
      }
    }
    throw error;
  }

  const statResult = await enrichStatResult(normalizedPath, config, requestId);
  return {
    requestId,
    path: normalizedPath,
    bytesWritten: bytes.byteLength,
    contentType,
    etag: statResult.entry.etag,
    updatedAt: statResult.entry.updatedAt,
  };
}

export async function moveJianguoyunPath(
  input: JianguoyunMoveInput,
  env?: RuntimeEnv,
): Promise<JianguoyunMoveResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const fromPath = normalizeUserPath(input.from, requestId);
  const toPath = normalizeUserPath(input.to, requestId);
  assertPathAllowed(fromPath, config, requestId);
  assertPathAllowed(toPath, config, requestId);
  assertWritablePath(fromPath, requestId);
  assertWritablePath(toPath, requestId);

  try {
    await fetchDav(
      requestId,
      config,
      "MOVE",
      resolveRemotePath(fromPath, config),
      {
        headers: {
          Destination: buildRemoteUrl(
            resolveRemotePath(toPath, config),
            config,
          ),
          Overwrite: input.overwrite === false ? "F" : "T",
        },
        expectedStatuses: [201, 204],
      },
    );
  } catch (error) {
    if (isJianguoyunError(error) && error.code === "CONFLICT") {
      if (input.overwrite === false) {
        throw createError(
          "ALREADY_EXISTS",
          409,
          requestId,
          `Destination path "${toPath}" already exists`,
          error,
        );
      }
    }
    throw error;
  }

  let entry: JianguoyunEntry | undefined;
  try {
    entry = await statInternal(toPath, config, requestId);
  } catch (error) {
    if (!isJianguoyunError(error) || error.code !== "NOT_FOUND") {
      throw error;
    }
  }

  return {
    requestId,
    from: fromPath,
    to: toPath,
    entry,
  };
}

export async function deleteJianguoyunPath(
  input: JianguoyunDeleteInput,
  env?: RuntimeEnv,
): Promise<JianguoyunDeleteResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(input.path, requestId);
  assertPathAllowed(normalizedPath, config, requestId);
  assertWritablePath(normalizedPath, requestId);

  const entry = await statInternal(normalizedPath, config, requestId);
  if (entry.isDir && input.recursive !== true) {
    const children = await listInternal(normalizedPath, config, requestId);
    if (children.entries.length > 0) {
      throw createError(
        "DIRECTORY_NOT_EMPTY",
        409,
        requestId,
        `Directory "${normalizedPath}" is not empty`,
      );
    }
  }

  await fetchDav(
    requestId,
    config,
    "DELETE",
    resolveRemotePath(normalizedPath, config),
    {
      expectedStatuses: [200, 204],
    },
  );

  return {
    requestId,
    path: normalizedPath,
    deleted: true,
  };
}

export async function createJianguoyunDirectory(
  input: JianguoyunMkdirInput,
  env?: RuntimeEnv,
): Promise<JianguoyunMkdirResult> {
  const config = getConfig(env);
  const requestId = createRequestId();
  const normalizedPath = normalizeUserPath(input.path, requestId);
  assertPathAllowed(normalizedPath, config, requestId);
  assertWritablePath(normalizedPath, requestId);

  try {
    await fetchDav(
      requestId,
      config,
      "MKCOL",
      resolveRemotePath(normalizedPath, config),
      {
        expectedStatuses: [201],
      },
    );
  } catch (error) {
    if (isJianguoyunError(error) && error.code === "CONFLICT") {
      throw createError(
        "ALREADY_EXISTS",
        409,
        requestId,
        `Directory "${normalizedPath}" already exists or parent is missing`,
        error,
      );
    }
    throw error;
  }

  return {
    requestId,
    path: normalizedPath,
    created: true,
  };
}
