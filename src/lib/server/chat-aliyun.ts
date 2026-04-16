import { createHmac, randomUUID } from "node:crypto";
import { posix as pathPosix } from "node:path";
import OcrClient, {
  RecognizeGeneralRequest,
} from "@alicloud/ocr-api20210707/dist/client.js";
import { Config as OpenApiConfig } from "@alicloud/openapi-client/dist/client.js";
import {
  type ChatAttachmentOCRResult,
  type ChatOCRResponse,
  type ChatSignedObjectUrlResponse,
  type ChatUploadPolicyResponse,
  isAllowedChatImageType,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from "@/lib/chat-message";

const DEFAULT_OSS_UPLOAD_PREFIX = "chat-images";
const DEFAULT_OCR_REGION = "cn-hangzhou";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 10;
const DEFAULT_UPLOAD_POLICY_TTL_SECONDS = 60 * 5;

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
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

function assertObjectKeyAllowed(objectKey: string) {
  const prefix = normalizePrefix(
    process.env.ALIYUN_OSS_UPLOAD_PREFIX || DEFAULT_OSS_UPLOAD_PREFIX,
  );
  if (!objectKey.startsWith(`${prefix}/`)) {
    throw new Error("Object key is outside the allowed upload prefix");
  }
}

function parseOCRData(raw: string | undefined): ChatAttachmentOCRResult {
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
    const parsed = JSON.parse(raw) as {
      content?: string;
      prism_wordsInfo?: Array<{ word?: string }>;
    };
    const lines =
      parsed.prism_wordsInfo
        ?.map((item) => item.word?.trim() ?? "")
        .filter(Boolean) ?? [];
    const plainText = (parsed.content ?? lines.join("\n")).trim();

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

let ocrClient: OcrClient | null = null;

function getOCRClient(): OcrClient {
  if (ocrClient) {
    return ocrClient;
  }

  const config = new OpenApiConfig({
    accessKeyId: getRequiredEnv("ALIYUN_ACCESS_KEY_ID"),
    accessKeySecret: getRequiredEnv("ALIYUN_ACCESS_KEY_SECRET"),
    regionId: process.env.ALIYUN_OCR_REGION || DEFAULT_OCR_REGION,
    endpoint: process.env.ALIYUN_OCR_ENDPOINT || undefined,
  });

  ocrClient = new OcrClient(config);
  return ocrClient;
}

export function buildChatUploadPolicy({
  conversationId,
  fileName,
  contentType,
  size,
}: BuildUploadPolicyOptions): ChatUploadPolicyResponse {
  assertAllowedImageUpload(contentType, size);

  const accessKeyId = getRequiredEnv("ALIYUN_ACCESS_KEY_ID");
  const accessKeySecret = getRequiredEnv("ALIYUN_ACCESS_KEY_SECRET");
  const bucket = getRequiredEnv("ALIYUN_OSS_BUCKET");
  const region = getRequiredEnv("ALIYUN_OSS_REGION");
  const prefix = normalizePrefix(
    process.env.ALIYUN_OSS_UPLOAD_PREFIX || DEFAULT_OSS_UPLOAD_PREFIX,
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

export function signChatObjectUrl({
  bucket,
  region,
  objectKey,
  expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
}: SignObjectUrlOptions): ChatSignedObjectUrlResponse {
  assertObjectKeyAllowed(objectKey);

  const accessKeyId = getRequiredEnv("ALIYUN_ACCESS_KEY_ID");
  const accessKeySecret = getRequiredEnv("ALIYUN_ACCESS_KEY_SECRET");
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const canonicalizedResource = `/${bucket}/${objectKey}`;
  const stringToSign = `GET\n\n\n${expiresAt}\n${canonicalizedResource}`;
  const signature = createHmac("sha1", accessKeySecret)
    .update(stringToSign)
    .digest("base64");

  const url = new URL(
    `${formatOssHost(bucket, region)}/${encodeObjectKeyForUrl(objectKey)}`,
  );
  url.searchParams.set("OSSAccessKeyId", accessKeyId);
  url.searchParams.set("Expires", String(expiresAt));
  url.searchParams.set("Signature", signature);

  return {
    url: url.toString(),
    expiresAt: expiresAt * 1000,
  };
}

export async function recognizeChatImage(
  bucket: string,
  region: string,
  objectKey: string,
): Promise<ChatOCRResponse> {
  const preview = signChatObjectUrl({ bucket, region, objectKey });
  const response = await getOCRClient().recognizeGeneral(
    new RecognizeGeneralRequest({
      url: preview.url,
    }),
  );

  const result = parseOCRData(response.body?.data);
  const code = String(response.body?.code ?? "");
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
        error: response.body?.message || `OCR request failed with code ${code}`,
        requestId: response.body?.requestId,
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
      ...result,
      requestId: response.body?.requestId,
    },
  };
}
