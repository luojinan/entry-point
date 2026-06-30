import {
  Cancel01Icon,
  PencilEdit02Icon,
  Sent02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DynamicToolUIPart } from "ai";
import { type KeyboardEvent, useEffect, useState } from "react";

import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { DynamicToolCard } from "@/components/chat/dynamic-tool-card";
import { ReasoningBlock } from "@/components/chat/reasoning-block";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  CHAT_IMAGE_PREVIEW_PROCESS,
  type ChatImageAttachment,
  type ChatMessage,
  type ChatSignedObjectUrlResponse,
  isImageAttachmentPart,
} from "@/lib/chat-message";
import { cn } from "@/lib/utils";

type ToolApprovalHandler = (opts: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

type EditUserMessageHandler = (messageId: string, text: string) => boolean;

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function fetchSignedObjectUrl(
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

  const payload =
    ((await response.json()) as ApiEnvelope<ChatSignedObjectUrlResponse>) ??
    null;
  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || "Failed to load image preview");
  }

  return payload.data;
}

function AttachmentCard({ attachment }: { attachment: ChatImageAttachment }) {
  const [previewUrl, setPreviewUrl] = useState(attachment.previewUrl);

  useEffect(() => {
    setPreviewUrl(attachment.previewUrl);
  }, [attachment.previewUrl]);

  useEffect(() => {
    const hasFreshPreview =
      attachment.previewUrl &&
      (!attachment.previewUrlExpiresAt ||
        attachment.previewUrlExpiresAt > Date.now());

    if (
      hasFreshPreview ||
      !attachment.bucket ||
      !attachment.region ||
      !attachment.objectKey
    ) {
      return;
    }

    let cancelled = false;
    fetchSignedObjectUrl(
      attachment.bucket,
      attachment.region,
      attachment.objectKey,
      CHAT_IMAGE_PREVIEW_PROCESS,
    )
      .then((result) => {
        if (!cancelled) {
          setPreviewUrl(result.url);
        }
      })
      .catch(() => {
        // ignore preview refresh errors and keep OCR text visible
      });

    return () => {
      cancelled = true;
    };
  }, [
    attachment.bucket,
    attachment.objectKey,
    attachment.previewUrl,
    attachment.previewUrlExpiresAt,
    attachment.region,
  ]);

  return (
    <Attachment className="block space-y-2 text-foreground">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={attachment.fileName}
          className="max-h-72 w-full rounded-md object-contain"
        />
      ) : null}

      <AttachmentContent className="text-xs">
        <AttachmentTitle className="text-sm">
          {attachment.fileName}
        </AttachmentTitle>
        <AttachmentDescription>
          {attachment.llmImageUrl
            ? "已发送给多模态模型"
            : attachment.ocr?.status === "ready"
              ? "OCR 已完成"
              : attachment.ocr?.status === "error"
                ? `OCR 失败: ${attachment.ocr.error || "未知错误"}`
                : "OCR 未完成"}
        </AttachmentDescription>
        {attachment.ocr?.plainText ? (
          <details className="text-muted-foreground whitespace-pre-wrap">
            <summary className="cursor-pointer select-none text-foreground">
              查看 OCR 文本
            </summary>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border bg-background/80 p-2">
              {attachment.ocr.plainText}
            </div>
          </details>
        ) : null}
      </AttachmentContent>
    </Attachment>
  );
}

function SourceUrlCard({ title, url }: { title?: string; url: string }) {
  return (
    <Marker variant="border" className="bg-background/70 rounded-lg px-3 py-2">
      <MarkerContent className="space-y-1 text-xs">
        <div className="text-muted-foreground">来源链接</div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-primary break-all underline underline-offset-4"
        >
          {title || url}
        </a>
      </MarkerContent>
    </Marker>
  );
}

function SourceDocumentCard({
  title,
  filename,
  mediaType,
}: {
  title: string;
  filename?: string;
  mediaType: string;
}) {
  return (
    <Marker variant="border" className="bg-background/70 rounded-lg px-3 py-2">
      <MarkerContent className="space-y-1 text-xs">
        <div className="text-muted-foreground">来源文档</div>
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground break-all">
          {filename || mediaType}
        </div>
      </MarkerContent>
    </Marker>
  );
}

function FileCard({
  filename,
  mediaType,
  url,
}: {
  filename?: string;
  mediaType: string;
  url: string;
}) {
  const isImage = mediaType.startsWith("image/");

  if (isImage) {
    return (
      <Attachment className="block space-y-2 text-xs">
        <img
          src={url}
          alt={filename || mediaType}
          className="max-h-72 w-full rounded-md object-contain"
        />
        <div className="text-muted-foreground break-all">
          {filename || mediaType}
        </div>
      </Attachment>
    );
  }

  return (
    <Attachment className="block text-xs">
      <AttachmentContent>
        <AttachmentDescription>文件</AttachmentDescription>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-primary break-all underline underline-offset-4"
        >
          {filename || url}
        </a>
        <AttachmentDescription className="break-all">
          {mediaType}
        </AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  );
}

/**
 * Static tool parts (created by `tool()`) have `type: "tool-${name}"`
 * instead of `type: "dynamic-tool"`. Normalize them so DynamicToolCard
 * can handle both uniformly.
 */
function asToolPart(part: { type: string }): DynamicToolUIPart | null {
  if (part.type === "dynamic-tool") {
    return part as DynamicToolUIPart;
  }
  if (part.type.startsWith("tool-")) {
    const toolName = part.type.slice("tool-".length);
    return { ...part, type: "dynamic-tool", toolName } as DynamicToolUIPart;
  }
  return null;
}

function getStringRecordValue(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" && item.trim() ? item : null;
}

function getFinalAnswerText(part: DynamicToolUIPart): string | null {
  return (
    getStringRecordValue(part.output, "answer") ??
    getStringRecordValue(part.input, "answer")
  );
}

function getUserMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

export function MessageBubble({
  message,
  isStreaming = false,
  onToolApproval,
  onEdit,
  editDisabled = false,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
  onToolApproval: ToolApprovalHandler;
  onEdit?: EditUserMessageHandler;
  editDisabled?: boolean;
}) {
  const isUser = message.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState("");
  const canEdit = isUser && !!onEdit && !editDisabled;

  function startEditing() {
    setEditingText(getUserMessageText(message));
    setIsEditing(true);
  }

  function cancelEditing() {
    setEditingText("");
    setIsEditing(false);
  }

  function submitEditing() {
    if (!onEdit?.(message.id, editingText)) {
      return;
    }
    cancelEditing();
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitEditing();
    }
  }

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <Bubble
          align={isUser ? "end" : "start"}
          variant={isUser ? "default" : "ghost"}
          className={cn(isUser ? "max-w-[92%] sm:max-w-[90%]" : "max-w-full")}
        >
          <BubbleContent className={cn(!isUser && "pl-2")}>
            {isEditing ? (
              <textarea
                value={editingText}
                onChange={(event) => setEditingText(event.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={3}
                autoFocus
                className="min-h-28 w-[calc(100vw-4rem)] max-w-full resize-y bg-transparent text-base leading-6 outline-none placeholder:text-primary-foreground/70 sm:min-h-24 sm:w-80 sm:text-sm"
              />
            ) : message.parts.every(
                (part) => part.type === "text" && part.text.length === 0,
              ) ? (
              <span className="bg-muted inline-flex rounded-lg px-3 py-2">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce">·</span>
                  <span className="animate-bounce [animation-delay:0.1s]">
                    ·
                  </span>
                  <span className="animate-bounce [animation-delay:0.2s]">
                    ·
                  </span>
                </span>
              </span>
            ) : (
              message.parts.map((part, i) => {
                const key = `${message.id}-${i}`;
                if (part.type === "text") {
                  if (isUser) {
                    return (
                      <div key={key} className="whitespace-pre-wrap">
                        {part.text}
                      </div>
                    );
                  }

                  return (
                    <div key={key} className="my-2 first:mt-0">
                      <ChatMarkdown
                        content={part.text}
                        isStreaming={isStreaming}
                      />
                    </div>
                  );
                }
                if (isImageAttachmentPart(part)) {
                  return <AttachmentCard key={key} attachment={part.data} />;
                }
                if (part.type === "reasoning") {
                  return <ReasoningBlock key={key} part={part} />;
                }
                if (part.type === "step-start") {
                  return null;
                }
                if (part.type === "source-url") {
                  return (
                    <div key={key} className="mt-2 first:mt-0">
                      <SourceUrlCard title={part.title} url={part.url} />
                    </div>
                  );
                }
                if (part.type === "source-document") {
                  return (
                    <div key={key} className="mt-2 first:mt-0">
                      <SourceDocumentCard
                        title={part.title}
                        filename={part.filename}
                        mediaType={part.mediaType}
                      />
                    </div>
                  );
                }
                if (part.type === "file") {
                  return (
                    <div key={key} className="mt-2 first:mt-0">
                      <FileCard
                        filename={part.filename}
                        mediaType={part.mediaType}
                        url={part.url}
                      />
                    </div>
                  );
                }
                const toolPart = asToolPart(part);
                if (toolPart) {
                  if (toolPart.toolName === "finalAnswer") {
                    const answer = getFinalAnswerText(toolPart);
                    if (!answer) {
                      return null;
                    }

                    return (
                      <div key={key} className="my-2 first:mt-0">
                        <ChatMarkdown
                          content={answer}
                          isStreaming={isStreaming}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={key} className="my-2 first:mt-0">
                      <DynamicToolCard
                        part={toolPart}
                        onApproval={onToolApproval}
                      />
                    </div>
                  );
                }
                return null;
              })
            )}
          </BubbleContent>
        </Bubble>

        {isUser && (
          <MessageFooter className="min-h-9 justify-end gap-1 sm:min-h-7">
            {isEditing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full sm:size-7"
                  onClick={cancelEditing}
                  aria-label="取消编辑"
                  title="取消编辑"
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full sm:size-7"
                  onClick={submitEditing}
                  disabled={!editingText.trim() || editDisabled}
                  aria-label="提交修改"
                  title="提交修改"
                >
                  <HugeiconsIcon icon={Sent02Icon} strokeWidth={2} />
                </Button>
              </>
            ) : canEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="rounded-full opacity-100 transition-opacity sm:size-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                onClick={startEditing}
                aria-label="编辑消息"
                title="编辑消息"
              >
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
              </Button>
            ) : null}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
