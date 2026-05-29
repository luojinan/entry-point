import type { DataUIPart, UIMessage } from "ai";

export const MAX_CHAT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const CHAT_IMAGE_PREVIEW_PROCESS = "image/format,webp";

export const ALLOWED_CHAT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ChatAttachmentStatus =
  | "uploading"
  | "uploaded"
  | "ocr-processing"
  | "ready"
  | "ocr-error"
  | "upload-error";

export interface ChatAttachmentOCRResult {
  status: "pending" | "ready" | "error";
  plainText: string;
  lines: string[];
  provider?: "aliyun-ocr";
  error?: string;
  requestId?: string;
}

export interface ChatImageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: ChatAttachmentStatus;
  bucket?: string;
  region?: string;
  objectKey?: string;
  previewUrl?: string;
  previewUrlExpiresAt?: number;
  llmImageUrl?: string;
  llmImageUrlExpiresAt?: number;
  error?: string;
  uploadedAt?: number;
  ocr?: ChatAttachmentOCRResult;
}

export type ChatDataParts = {
  imageAttachment: ChatImageAttachment;
};

export type ChatMessage = UIMessage<never, ChatDataParts>;

export type ChatImageAttachmentPart = DataUIPart<ChatDataParts>;

export function isAllowedChatImageType(contentType: string): boolean {
  return (ALLOWED_CHAT_IMAGE_TYPES as readonly string[]).includes(contentType);
}

export function createImageAttachmentPart(
  attachment: ChatImageAttachment,
): ChatImageAttachmentPart {
  return {
    type: "data-imageAttachment",
    id: attachment.id,
    data: attachment,
  };
}

export function isImageAttachmentPart(part: {
  type: string;
  data?: unknown;
}): part is ChatImageAttachmentPart {
  return part.type === "data-imageAttachment";
}

export interface ChatUploadPolicyRequest {
  conversationId: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ChatUploadPolicyResponse {
  bucket: string;
  region: string;
  host: string;
  objectKey: string;
  policy: string;
  signature: string;
  ossAccessKeyId: string;
  successActionStatus: string;
  expireAt: number;
}

export interface ChatSignedObjectUrlRequest {
  bucket: string;
  region: string;
  objectKey: string;
  imageProcess?: string;
}

export interface ChatSignedObjectUrlResponse {
  url: string;
  expiresAt: number;
}

export interface ChatOCRRequest extends ChatSignedObjectUrlRequest {}

export interface ChatOCRResponse {
  bucket: string;
  region: string;
  objectKey: string;
  previewUrl: string;
  previewUrlExpiresAt: number;
  ocr: ChatAttachmentOCRResult;
}
