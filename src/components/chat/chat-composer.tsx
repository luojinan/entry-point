import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUp02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
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

import {
  AskUserQuestionForm,
  type AskUserQuestionAnswers,
  createInitialAskUserQuestionAnswers,
  formatAskUserQuestionAnswersForReason,
  getUnansweredRequiredAskUserQuestions,
  normalizeAskUserQuestionInput,
} from "./ask-user-question-card";
import { ChatSkillsViewer } from "./chat-skills-viewer";

interface ChatComposerProps {
  conversationId: string;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  onModelChange: (id: AIModelId) => void;
  onSubmit: (text: string, attachments?: ChatImageAttachment[]) => boolean;
  pendingAskUserQuestion?: {
    approvalId: string;
    input: unknown;
  } | null;
  onAskUserQuestionSubmit?: (opts: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void | PromiseLike<void>;
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
  pendingAskUserQuestion = null,
  onAskUserQuestionSubmit,
  thinkingEnabled = false,
  onThinkingEnabledChange,
  selectedSkillIds = [],
  onSelectedSkillIdsChange,
  disabled = false,
  placeholder = "Ask anything",
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [askUserQuestionAnswers, setAskUserQuestionAnswers] =
    useState<AskUserQuestionAnswers>({});
  const [askUserQuestionCollapsed, setAskUserQuestionCollapsed] =
    useState(false);
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

  const normalizedAskUserQuestion = useMemo(
    () =>
      pendingAskUserQuestion
        ? normalizeAskUserQuestionInput(pendingAskUserQuestion.input)
        : null,
    [pendingAskUserQuestion?.approvalId, pendingAskUserQuestion?.input],
  );

  useEffect(() => {
    if (!normalizedAskUserQuestion) {
      setAskUserQuestionAnswers({});
      setAskUserQuestionCollapsed(false);
      return;
    }

    setAskUserQuestionCollapsed(false);
    setAskUserQuestionAnswers(
      createInitialAskUserQuestionAnswers(normalizedAskUserQuestion.questions),
    );
  }, [normalizedAskUserQuestion, pendingAskUserQuestion?.approvalId]);

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
  const unansweredAskUserQuestions = normalizedAskUserQuestion
    ? getUnansweredRequiredAskUserQuestions({
        input: normalizedAskUserQuestion,
        answers: askUserQuestionAnswers,
      })
    : [];
  const canSubmitAskUserQuestion =
    !!pendingAskUserQuestion &&
    !!normalizedAskUserQuestion &&
    !!onAskUserQuestionSubmit &&
    !disabled &&
    !hasPendingAttachments &&
    unansweredAskUserQuestions.length === 0;
  const canSend =
    canSubmitAskUserQuestion ||
    (Boolean(modelId) &&
      !disabled &&
      !hasPendingAttachments &&
      (input.trim().length > 0 || sendableAttachments.length > 0));
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
      if (pendingAskUserQuestion && unansweredAskUserQuestions.length > 0) {
        setComposerError(
          `还有 ${unansweredAskUserQuestions.length} 个必填问题未选择。`,
        );
      }
      return;
    }

    setComposerError(null);
    if (
      pendingAskUserQuestion &&
      normalizedAskUserQuestion &&
      onAskUserQuestionSubmit
    ) {
      void onAskUserQuestionSubmit({
        id: pendingAskUserQuestion.approvalId,
        approved: true,
        reason: formatAskUserQuestionAnswersForReason({
          input: normalizedAskUserQuestion,
          answers: askUserQuestionAnswers,
          note: input,
        }),
      });
      setInput("");
      setAskUserQuestionAnswers(
        createInitialAskUserQuestionAnswers(
          normalizedAskUserQuestion.questions,
        ),
      );
      return;
    }

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
            <Attachment
              key={attachment.id}
              state={
                attachment.status === "upload-error" ||
                attachment.status === "ocr-error"
                  ? "error"
                  : attachment.status === "uploading"
                    ? "uploading"
                    : attachment.status === "ocr-processing"
                      ? "processing"
                      : "done"
              }
              className="w-full sm:w-[calc(50%-0.25rem)]"
            >
              <AttachmentMedia variant="image" className="size-16">
                {attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.fileName}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </AttachmentMedia>
              <AttachmentContent className="text-sm">
                <AttachmentTitle>{attachment.fileName}</AttachmentTitle>
                <AttachmentDescription>
                  {formatAttachmentStatus(attachment)}
                </AttachmentDescription>
                {attachment.ocr?.plainText && (
                  <AttachmentDescription className="line-clamp-3 whitespace-pre-wrap">
                    {attachment.ocr.plainText}
                  </AttachmentDescription>
                )}
              </AttachmentContent>
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
            </Attachment>
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

      <InputGroup className="shadow-xs relative min-h-28 rounded-2xl px-4 pt-4 pb-3 has-[>textarea]:flex-col has-[>textarea]:items-stretch">
        {pendingAskUserQuestion && (
          <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 flex translate-y-px justify-center px-3 sm:px-8">
            {askUserQuestionCollapsed && (
              <button
                type="button"
                className="border-input/80 bg-background pointer-events-auto flex h-10 w-[94%] items-center gap-2 rounded-t-xl rounded-b-none border px-3 text-left text-sm transition-colors hover:bg-muted/40"
                onClick={() => setAskUserQuestionCollapsed(false)}
                aria-expanded={false}
                title="展开问题面板"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {normalizedAskUserQuestion?.title ?? "需要用户确认"}
                </span>
                <HugeiconsIcon
                  icon={ArrowUp01Icon}
                  strokeWidth={2}
                  className="size-4 shrink-0"
                />
              </button>
            )}
            <div
              className={cn(
                "pointer-events-auto relative w-[94%]",
                askUserQuestionCollapsed && "hidden",
              )}
            >
              <AskUserQuestionForm
                input={pendingAskUserQuestion.input}
                answers={askUserQuestionAnswers}
                onAnswersChange={(answers) => {
                  setAskUserQuestionAnswers(answers);
                  setComposerError(null);
                }}
                className="w-full rounded-t-2xl rounded-b-none border-input/80 bg-background"
                headerAction={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-full bg-background hover:bg-muted"
                    onClick={() => setAskUserQuestionCollapsed(true)}
                    aria-expanded={true}
                    aria-label="收起问题面板"
                    title="收起问题面板"
                  >
                    <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
                  </Button>
                }
              />
            </div>
          </div>
        )}
        <InputGroupTextarea
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
            "placeholder:text-muted-foreground w-full resize-none overflow-y-auto px-0 pt-0 pb-2 text-[1.05rem] leading-6 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            "[field-sizing:content] min-h-4 max-h-48",
          )}
        />
        <InputGroupAddon align="block-end" className="min-h-10 px-0 pb-0">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <InputGroupButton
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
          </InputGroupButton>

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

          <InputGroupButton
            onClick={handleSubmit}
            disabled={!canSend}
            size="icon-lg"
            className="size-12 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
            aria-label="发送"
            title="发送"
          >
            <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2.4} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
