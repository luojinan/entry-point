import { createHmac, randomUUID } from "node:crypto";
import { posix as pathPosix } from "node:path";

import * as Credentials from "@alicloud/credentials";
import type CredentialClient from "@alicloud/credentials/dist/src/client.js";
import * as OCRApi from "@alicloud/ocr-api20210707";
import type OCRClientInstance from "@alicloud/ocr-api20210707/dist/client.js";
import { $OpenApiUtil } from "@alicloud/openapi-core";

import {
  CHAT_IMAGE_PREVIEW_PROCESS,
  type ChatAttachmentOCRResult,
  type ChatOCRResponse,
  type ChatSignedObjectUrlResponse,
  type ChatUploadPolicyResponse,
  isAllowedChatImageType,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from "@/lib/chat-message";
import {
  getRequiredRuntimeEnvValue,
  getRuntimeEnvValue,
  type RuntimeEnv,
} from "@/lib/runtime-env";

const DEFAULT_OSS_UPLOAD_PREFIX = "chat-images";
const DEFAULT_OCR_REGION = "cn-hangzhou";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 10;
const DEFAULT_UPLOAD_POLICY_TTL_SECONDS = 60 * 5;
const { Config: CredentialConfig } = Credentials;
const { RecognizeAllTextRequest } = OCRApi;

type Constructor<T> = new (...args: unknown[]) => T;

function resolveModuleConstructor<T>(
  value: unknown,
  packageName: string,
): Constructor<T> {
  const moduleRecord =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  const candidates = [moduleRecord?.default, moduleRecord?.default?.default];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate as Constructor<T>;
    }
  }

  throw new TypeError(`Failed to resolve constructor from ${packageName}`);
}

const CredentialCtor = resolveModuleConstructor<CredentialClient>(
  Credentials,
  "@alicloud/credentials",
);
const OCRClientCtor = resolveModuleConstructor<OCRClientInstance>(
  OCRApi,
  "@alicloud/ocr-api20210707",
);

interface BuildUploadPolicyOptions {
  conversationId: string;
  fileName: string;
  contentType: string;
  size: number;
}

interface SignObjectUrlOptions {
  bucket: string;
  region: string;
  objectKey: string;
  expiresInSeconds?: number;
  imageProcess?: string;
}

function getRequiredEnv(name: string | string[], env?: RuntimeEnv): string {
  return getRequiredRuntimeEnvValue(env, name);
}

function getAliyunAccessKeyId(env?: RuntimeEnv): string {
  return getRequiredEnv(
    ["ALIBABA_CLOUD_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_ID"],
    env,
  );
}

function getAliyunAccessKeySecret(env?: RuntimeEnv): string {
  return getRequiredEnv(
    ["ALIBABA_CLOUD_ACCESS_KEY_SECRET", "ALIYUN_ACCESS_KEY_SECRET"],
    env,
  );
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized || "unknown";
}

function sanitizeFileName(fileName: string): string {
  const ext = pathPosix.extname(fileName).toLowerCase();
  const baseName = pathPosix.basename(fileName, ext);
  const safeBaseName = sanitizeSegment(baseName).slice(0, 80);
  const safeExt = ext.replace(/[^a-z0-9.]/g, "").slice(0, 10);
  return `${safeBaseName || "image"}${safeExt}`;
}

function formatOssHost(bucket: string, region: string): string {
  return `https://${bucket}.oss-${region}.aliyuncs.com`;
}

function encodeObjectKeyForUrl(objectKey: string): string {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function formatCanonicalizedResource(
  bucket: string,
  objectKey: string,
  imageProcess?: string,
): string {
  const resource = `/${bucket}/${objectKey}`;
  return imageProcess ? `${resource}?x-oss-process=${imageProcess}` : resource;
}

function assertAllowedImageUpload(contentType: string, size: number) {
  if (!isAllowedChatImageType(contentType)) {
    throw new Error(`Unsupported image content type: ${contentType}`);
  }

  if (size <= 0 || size > MAX_CHAT_IMAGE_SIZE_BYTES) {
    throw new Error(
      `Image size must be between 1 byte and ${MAX_CHAT_IMAGE_SIZE_BYTES} bytes`,
    );
  }
}

function assertObjectKeyAllowed(objectKey: string, env?: RuntimeEnv) {
  const prefix = normalizePrefix(
    getRuntimeEnvValue(env, "ALIYUN_OSS_UPLOAD_PREFIX") ||
      DEFAULT_OSS_UPLOAD_PREFIX,
  );
  if (!objectKey.startsWith(`${prefix}/`)) {
    throw new Error("Object key is outside the allowed upload prefix");
  }
}

function parseOCRData(
  raw:
    | string
    | {
        content?: string;
        prism_wordsInfo?: Array<{ word?: string }>;
      }
    | undefined,
): ChatAttachmentOCRResult {
  if (!raw) {
    return {
      status: "error",
      plainText: "",
      lines: [],
      provider: "aliyun-ocr",
      error: "OCR response did not contain data",
    };
  }

  try {
    const parsed =
      typeof raw === "string"
        ? (JSON.parse(raw) as {
            content?: string;
            prism_wordsInfo?: Array<{ word?: string }>;
          })
        : raw;
    const wordLines =
      parsed.prism_wordsInfo
        ?.map((item) => item.word?.trim() ?? "")
        .filter(Boolean) ?? [];
    const plainText = (parsed.content ?? wordLines.join("\n")).trim();
    const lines =
      wordLines.length > 0
        ? wordLines
        : plainText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

    return {
      status: "ready",
      plainText,
      lines,
      provider: "aliyun-ocr",
    };
  } catch {
    return {
      status: "ready",
      plainText: raw.trim(),
      lines: raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      provider: "aliyun-ocr",
    };
  }
}

interface OCRInvokeResult {
  code: string;
  message?: string;
  requestId?: string;
  ocr: ChatAttachmentOCRResult;
}

let ocrClient: OCRClientInstance | null = null;

function getOCRClient(env?: RuntimeEnv): OCRClientInstance {
  if (ocrClient) {
    return ocrClient;
  }

  const regionId =
    getRuntimeEnvValue(env, "ALIYUN_OCR_REGION") || DEFAULT_OCR_REGION;
  const credential = new CredentialCtor(
    new CredentialConfig({
      type: "access_key",
      accessKeyId: getAliyunAccessKeyId(env),
      accessKeySecret: getAliyunAccessKeySecret(env),
    }),
  );
  const config = new $OpenApiUtil.Config({
    credential,
    regionId,
  });
  config.endpoint =
    getRuntimeEnvValue(env, "ALIYUN_OCR_ENDPOINT") ||
    `ocr-api.${regionId}.aliyuncs.com`;

  ocrClient = new OCRClientCtor(config);
  return ocrClient;
}

async function recognizeWithAllText(
  url: string,
  env?: RuntimeEnv,
): Promise<OCRInvokeResult> {
  const response = await getOCRClient(env).recognizeAllText(
    new RecognizeAllTextRequest({
      type: "General",
      url,
    }),
  );

  return {
    code: String(response.body?.code ?? ""),
    message: response.body?.message,
    requestId: response.body?.requestId,
    ocr: parseOCRData(response.body?.data),
  };
}

export function buildChatUploadPolicy(
  { conversationId, fileName, contentType, size }: BuildUploadPolicyOptions,
  env?: RuntimeEnv,
): ChatUploadPolicyResponse {
  assertAllowedImageUpload(contentType, size);

  const accessKeyId = getAliyunAccessKeyId(env);
  const accessKeySecret = getAliyunAccessKeySecret(env);
  const bucket = getRequiredEnv("ALIYUN_OSS_BUCKET", env);
  const region = getRequiredEnv("ALIYUN_OSS_REGION", env);
  const prefix = normalizePrefix(
    getRuntimeEnvValue(env, "ALIYUN_OSS_UPLOAD_PREFIX") ||
      DEFAULT_OSS_UPLOAD_PREFIX,
  );

  const safeConversationId = sanitizeSegment(conversationId).slice(0, 64);
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeFileName = sanitizeFileName(fileName);
  const objectKey = `${prefix}/${year}/${month}/${safeConversationId}/${randomUUID()}-${safeFileName}`;
  const expireAt = Date.now() + DEFAULT_UPLOAD_POLICY_TTL_SECONDS * 1000;

  const policy = Buffer.from(
    JSON.stringify({
      expiration: new Date(expireAt).toISOString(),
      conditions: [
        ["eq", "$key", objectKey],
        ["eq", "$Content-Type", contentType],
        ["content-length-range", 1, MAX_CHAT_IMAGE_SIZE_BYTES],
        ["eq", "$success_action_status", "204"],
      ],
    }),
  ).toString("base64");

  const signature = createHmac("sha1", accessKeySecret)
    .update(policy)
    .digest("base64");

  return {
    bucket,
    region,
    host: formatOssHost(bucket, region),
    objectKey,
    policy,
    signature,
    ossAccessKeyId: accessKeyId,
    successActionStatus: "204",
    expireAt,
  };
}

export function signChatObjectUrl(
  {
    bucket,
    region,
    objectKey,
    expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
    imageProcess,
  }: SignObjectUrlOptions,
  env?: RuntimeEnv,
): ChatSignedObjectUrlResponse {
  assertObjectKeyAllowed(objectKey, env);
  if (imageProcess && imageProcess !== CHAT_IMAGE_PREVIEW_PROCESS) {
    throw new Error("Unsupported image process");
  }

  const accessKeyId = getAliyunAccessKeyId(env);
  const accessKeySecret = getAliyunAccessKeySecret(env);
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const canonicalizedResource = formatCanonicalizedResource(
    bucket,
    objectKey,
    imageProcess,
  );
  const stringToSign = `GET\n\n\n${expiresAt}\n${canonicalizedResource}`;
  const signature = createHmac("sha1", accessKeySecret)
    .update(stringToSign)
    .digest("base64");

  const url = `${formatOssHost(bucket, region)}/${encodeObjectKeyForUrl(
    objectKey,
  )}`;
  const authParams = new URLSearchParams({
    OSSAccessKeyId: accessKeyId,
    Expires: String(expiresAt),
    Signature: signature,
  });
  const query = imageProcess
    ? `x-oss-process=${imageProcess}&${authParams.toString()}`
    : authParams.toString();

  return {
    url: `${url}?${query}`,
    expiresAt: expiresAt * 1000,
  };
}

export async function recognizeChatImage(
  bucket: string,
  region: string,
  objectKey: string,
  env?: RuntimeEnv,
): Promise<ChatOCRResponse> {
  const ocrImage = signChatObjectUrl({ bucket, region, objectKey }, env);
  const preview = signChatObjectUrl(
    {
      bucket,
      region,
      objectKey,
      imageProcess: CHAT_IMAGE_PREVIEW_PROCESS,
    },
    env,
  );
  const result = await recognizeWithAllText(ocrImage.url, env);
  const code = result.code;
  if (code && code !== "200") {
    return {
      bucket,
      region,
      objectKey,
      previewUrl: preview.url,
      previewUrlExpiresAt: preview.expiresAt,
      ocr: {
        status: "error",
        plainText: "",
        lines: [],
        provider: "aliyun-ocr",
        error: result.message || `OCR request failed with code ${code}`,
        requestId: result.requestId,
      },
    };
  }

  return {
    bucket,
    region,
    objectKey,
    previewUrl: preview.url,
    previewUrlExpiresAt: preview.expiresAt,
    ocr: {
      ...result.ocr,
      requestId: result.requestId,
    },
  };
}
