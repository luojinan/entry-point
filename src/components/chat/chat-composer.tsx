import { Add01Icon, ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AIModelId, AIModelOption } from "@/lib/ai-models";
import {
  ALLOWED_CHAT_IMAGE_TYPES,
  CHAT_IMAGE_PREVIEW_PROCESS,
  type ChatImageAttachment,
  type ChatSignedObjectUrlResponse,
  type ChatOCRResponse,
  type ChatUploadPolicyRequest,
  type ChatUploadPolicyResponse,
  isAllowedChatImageType,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from "@/lib/chat-message";
import { cn } from "@/lib/utils";

import { ChatSkillsViewer } from "./chat-skills-viewer";

interface ChatComposerProps {
  conversationId: string;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  onModelChange: (id: AIModelId) => void;
  onSubmit: (text: string, attachments?: ChatImageAttachment[]) => boolean;
  thinkingEnabled?: boolean;
  onThinkingEnabledChange?: (enabled: boolean) => void;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (skillIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

const ACCEPTED_IMAGE_TYPES = ALLOWED_CHAT_IMAGE_TYPES.join(",");

async function readJSON<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "请求失败");
  }
  return payload.data;
}

async function requestUploadPolicy(
  payload: ChatUploadPolicyRequest,
): Promise<ChatUploadPolicyResponse> {
  const response = await fetch("/api/chat-upload-policy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return readJSON<ChatUploadPolicyResponse>(response);
}

async function uploadFileToOSS(
  file: File,
  policy: ChatUploadPolicyResponse,
): Promise<void> {
  const formData = new FormData();
  formData.set("key", policy.objectKey);
  formData.set("policy", policy.policy);
  formData.set("OSSAccessKeyId", policy.ossAccessKeyId);
  formData.set("signature", policy.signature);
  formData.set("success_action_status", policy.successActionStatus);
  formData.set("Content-Type", file.type);
  formData.set("file", file);

  const response = await fetch(policy.host, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OSS upload failed with status ${response.status}`);
  }
}

async function requestOCR(
  bucket: string,
  region: string,
  objectKey: string,
): Promise<ChatOCRResponse> {
  const response = await fetch("/api/chat-ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bucket,
      region,
      objectKey,
    }),
  });

  return readJSON<ChatOCRResponse>(response);
}

async function requestSignedObjectUrl(
  bucket: string,
  region: string,
  objectKey: string,
  imageProcess?: string,
): Promise<ChatSignedObjectUrlResponse> {
  const response = await fetch("/api/chat-object-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bucket,
      region,
      objectKey,
      imageProcess,
    }),
  });

  return readJSON<ChatSignedObjectUrlResponse>(response);
}

function formatAttachmentStatus(attachment: ChatImageAttachment): string {
  switch (attachment.status) {
    case "uploading":
      return "上传中";
    case "uploaded":
      return "上传完成";
    case "ocr-processing":
      return "OCR 识别中";
    case "ready":
      return attachment.llmImageUrl
        ? "可发送给多模态模型"
        : attachment.ocr?.plainText
          ? "可发送"
          : "已上传";
    case "ocr-error":
      return attachment.error || attachment.ocr?.error || "OCR 失败";
    case "upload-error":
      return attachment.error || "上传失败";
    default:
      return "";
  }
}

function revokePreviewUrl(url?: string) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function ChatComposer({
  conversationId,
  modelId,
  modelOptions,
  onModelChange,
  onSubmit,
  thinkingEnabled = false,
  onThinkingEnabledChange,
  selectedSkillIds = [],
  onSelectedSkillIdsChange,
  disabled = false,
  placeholder = "Ask anything",
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ChatImageAttachment[]>([]);

  attachmentsRef.current = attachments;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        revokePreviewUrl(attachment.previewUrl);
      }
    };
  }, []);

  const selectedModel = modelOptions.find((model) => model.id === modelId);
  const selectedModelSupportsMultimodal =
    selectedModel?.supportsMultimodal ?? false;
  const hasPendingAttachments = attachments.some(
    (attachment) =>
      attachment.status === "uploading" ||
      attachment.status === "ocr-processing",
  );
  const sendableAttachments = attachments.filter(
    (attachment) =>
      Boolean(attachment.bucket && attachment.region && attachment.objectKey) &&
      attachment.status !== "upload-error" &&
      (selectedModelSupportsMultimodal ||
        attachment.ocr?.status === "ready" ||
        attachment.ocr?.status === "error"),
  );
  const canSend =
    Boolean(modelId) &&
    !disabled &&
    !hasPendingAttachments &&
    (input.trim().length > 0 || sendableAttachments.length > 0);
  const updateAttachment = (
    id: string,
    updater: (attachment: ChatImageAttachment) => ChatImageAttachment,
  ) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.id === id ? updater(attachment) : attachment,
      ),
    );
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== id);
      const removed = current.find((attachment) => attachment.id === id);
      revokePreviewUrl(removed?.previewUrl);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSend) {
      return;
    }

    setComposerError(null);
    const submitted = onSubmit(input.trim(), sendableAttachments);
    if (!submitted) {
      return;
    }

    const sentAttachmentIds = new Set(
      sendableAttachments.map((attachment) => attachment.id),
    );
    setInput("");
    setAttachments((current) => {
      for (const attachment of current) {
        if (!sentAttachmentIds.has(attachment.id)) {
          revokePreviewUrl(attachment.previewUrl);
        }
      }
      return [];
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }

    const nativeEvent = e.nativeEvent;
    const isImeComposing =
      nativeEvent.isComposing || nativeEvent.keyCode === 229;
    if (isImeComposing) {
      return;
    }

    e.preventDefault();
    handleSubmit();
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files ?? []);
    if (fileList.length === 0) {
      return;
    }

    setComposerError(null);

    await Promise.all(
      fileList.map(async (file) => {
        const attachmentId = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(file);
        const initialAttachment: ChatImageAttachment = {
          id: attachmentId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          status: "uploading",
          previewUrl,
          ocr: {
            status: "pending",
            plainText: "",
            lines: [],
          },
        };

        if (!isAllowedChatImageType(file.type)) {
          initialAttachment.status = "upload-error";
          initialAttachment.error = "仅支持 JPG、PNG、WEBP、GIF 图片";
          setAttachments((current) => [...current, initialAttachment]);
          return;
        }

        if (file.size > MAX_CHAT_IMAGE_SIZE_BYTES) {
          initialAttachment.status = "upload-error";
          initialAttachment.error = `图片不能超过 ${Math.floor(
            MAX_CHAT_IMAGE_SIZE_BYTES / (1024 * 1024),
          )}MB`;
          setAttachments((current) => [...current, initialAttachment]);
          return;
        }

        setAttachments((current) => [...current, initialAttachment]);

        try {
          const policy = await requestUploadPolicy({
            conversationId,
            fileName: file.name,
            contentType: file.type,
            size: file.size,
          });

          await uploadFileToOSS(file, policy);

          updateAttachment(attachmentId, (attachment) => ({
            ...attachment,
            status: selectedModelSupportsMultimodal
              ? "uploaded"
              : "ocr-processing",
            bucket: policy.bucket,
            region: policy.region,
            objectKey: policy.objectKey,
            uploadedAt: Date.now(),
          }));

          if (selectedModelSupportsMultimodal) {
            const signedObjectUrl = await requestSignedObjectUrl(
              policy.bucket,
              policy.region,
              policy.objectKey,
              CHAT_IMAGE_PREVIEW_PROCESS,
            );

            updateAttachment(attachmentId, (attachment) => ({
              ...attachment,
              status: "ready",
              bucket: policy.bucket,
              region: policy.region,
              objectKey: policy.objectKey,
              previewUrl: signedObjectUrl.url || attachment.previewUrl,
              previewUrlExpiresAt: signedObjectUrl.expiresAt,
              llmImageUrl: signedObjectUrl.url,
              llmImageUrlExpiresAt: signedObjectUrl.expiresAt,
            }));
            return;
          }

          const ocrResult = await requestOCR(
            policy.bucket,
            policy.region,
            policy.objectKey,
          );

          updateAttachment(attachmentId, (attachment) => ({
            ...attachment,
            status: ocrResult.ocr.status === "ready" ? "ready" : "ocr-error",
            bucket: ocrResult.bucket,
            region: ocrResult.region,
            objectKey: ocrResult.objectKey,
            previewUrl: ocrResult.previewUrl || attachment.previewUrl,
            previewUrlExpiresAt: ocrResult.previewUrlExpiresAt,
            error: ocrResult.ocr.error,
            ocr: ocrResult.ocr,
          }));
        } catch (error) {
          updateAttachment(attachmentId, (attachment) => ({
            ...attachment,
            status: attachment.objectKey ? "ocr-error" : "upload-error",
            error: error instanceof Error ? error.message : "处理图片失败",
            ocr: attachment.objectKey
              ? {
                  status: "error",
                  plainText: "",
                  lines: [],
                  error:
                    error instanceof Error ? error.message : "OCR 识别失败",
                }
              : attachment.ocr,
          }));
        }
      }),
    );

    event.target.value = "";
  };

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="bg-muted/40 flex w-full items-start gap-3 rounded-lg border p-2 sm:w-[calc(50%-0.25rem)]"
            >
              <div className="bg-muted h-16 w-16 shrink-0 overflow-hidden rounded-md">
                {attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.fileName}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="truncate font-medium">
                  {attachment.fileName}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatAttachmentStatus(attachment)}
                </div>
                {attachment.ocr?.plainText && (
                  <div className="text-muted-foreground line-clamp-3 text-xs whitespace-pre-wrap">
                    {attachment.ocr.plainText}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                onClick={() => {
                  removeAttachment(attachment.id);
                }}
                aria-label={`移除 ${attachment.fileName}`}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}

      {(composerError || hasPendingAttachments) && (
        <div className="text-muted-foreground text-xs">
          {composerError ||
            (selectedModelSupportsMultimodal
              ? "图片正在上传中，完成后会以图片 URL 发送给当前多模态模型。"
              : "图片正在上传或识别中，完成后才可发送，以免丢失 OCR 上下文。")}
        </div>
      )}

      <div className="border-input bg-background shadow-xs rounded-2xl border px-4 pt-4 pb-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "placeholder:text-muted-foreground w-full resize-none overflow-y-auto bg-transparent px-0 text-[1.05rem] leading-6 outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            "[field-sizing:content] min-h-9 max-h-48",
          )}
        />
        <div className="flex min-h-10 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <Button
            variant="ghost"
            size="icon-lg"
            disabled={disabled}
            className="-ml-1 rounded-full text-foreground hover:bg-muted"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            aria-label="上传图片"
            title="上传图片"
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <Select
              value={modelId}
              onValueChange={(val) => {
                onModelChange(val as AIModelId);
              }}
            >
              <SelectTrigger
                size="sm"
                className="border-transparent px-2 text-base font-medium hover:bg-muted data-[size=sm]:h-9 md:text-sm"
                disabled={modelOptions.length === 0}
              >
                <SelectValue
                  placeholder={
                    modelOptions.length > 0 ? "选择模型" : "暂无可用模型"
                  }
                >
                  {selectedModel ? selectedModel.label : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label} · {model.providerLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ChatSkillsViewer
              selectedSkillIds={selectedSkillIds}
              onSelectedSkillIdsChange={onSelectedSkillIdsChange}
              disabled={disabled}
              triggerClassName="rounded-full border-transparent bg-transparent hover:bg-muted"
            />

            <label
              className="hover:bg-muted inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm transition-colors"
              title="思考模式"
            >
              <span className="text-muted-foreground text-xs font-medium">
                思考
              </span>
              <Switch
                checked={thinkingEnabled}
                disabled={disabled}
                aria-label="思考模式"
                onCheckedChange={(checked) => {
                  onThinkingEnabledChange?.(checked);
                }}
              />
            </label>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!canSend}
            size="icon-lg"
            className="size-12 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
            aria-label="发送"
            title="发送"
          >
            <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2.4} />
          </Button>
        </div>
      </div>
    </div>
  );
}
