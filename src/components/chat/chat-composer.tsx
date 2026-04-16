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
import type { AIModelId, AIModelOption } from "@/lib/ai-models";
import {
  ALLOWED_CHAT_IMAGE_TYPES,
  type ChatImageAttachment,
  type ChatOCRResponse,
  type ChatUploadPolicyRequest,
  type ChatUploadPolicyResponse,
  isAllowedChatImageType,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from "@/lib/chat-message";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  conversationId: string;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  onModelChange: (id: AIModelId) => void;
  onSubmit: (text: string, attachments?: ChatImageAttachment[]) => boolean;
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

function formatAttachmentStatus(attachment: ChatImageAttachment): string {
  switch (attachment.status) {
    case "uploading":
      return "上传中";
    case "uploaded":
      return "上传完成";
    case "ocr-processing":
      return "OCR 识别中";
    case "ready":
      return attachment.ocr?.plainText ? "可发送" : "已上传";
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
  disabled = false,
  placeholder = "输入消息... (Enter 发送, Shift+Enter 换行)",
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

  const hasPendingAttachments = attachments.some(
    (attachment) =>
      attachment.status === "uploading" ||
      attachment.status === "ocr-processing",
  );
  const sendableAttachments = attachments.filter(
    (attachment) =>
      Boolean(attachment.bucket && attachment.region && attachment.objectKey) &&
      attachment.status !== "upload-error",
  );
  const canSend =
    Boolean(modelId) &&
    !disabled &&
    !hasPendingAttachments &&
    (input.trim().length > 0 || sendableAttachments.length > 0);
  const selectedModel = modelOptions.find((model) => model.id === modelId);

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
            status: "ocr-processing",
            bucket: policy.bucket,
            region: policy.region,
            objectKey: policy.objectKey,
            uploadedAt: Date.now(),
          }));

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
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={modelId}
          onValueChange={(val) => {
            onModelChange(val as AIModelId);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-fit min-w-44"
            disabled={modelOptions.length === 0}
          >
            <SelectValue
              placeholder={
                modelOptions.length > 0 ? "选择模型" : "暂无可用模型"
              }
            >
              {selectedModel
                ? `${selectedModel.label} · ${selectedModel.providerLabel}`
                : undefined}
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

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          上传图片
        </Button>
      </div>

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
            "图片正在上传或识别中，完成后才可发送，以免丢失 OCR 上下文。"}
        </div>
      )}

      <div className="flex items-end gap-2">
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
            "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 rounded-lg border bg-transparent px-3 py-2 text-base transition-[color,border-color,box-shadow] placeholder:text-muted-foreground flex-1 resize-none overflow-y-auto outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            "[field-sizing:content] min-h-9 max-h-48",
          )}
        />
        <Button onClick={handleSubmit} disabled={!canSend} size="default">
          发送
        </Button>
      </div>
    </div>
  );
}
