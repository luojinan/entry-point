import type { DynamicToolUIPart } from "ai";
import { useEffect, useState } from "react";

import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { DynamicToolCard } from "@/components/chat/dynamic-tool-card";
import { ReasoningBlock } from "@/components/chat/reasoning-block";
import {
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

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

async function fetchSignedObjectUrl(
  bucket: string,
  region: string,
  objectKey: string,
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
    <div className="bg-background/70 space-y-2 rounded-lg border px-3 py-2 text-foreground">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={attachment.fileName}
          className="max-h-72 w-full rounded-md object-contain"
        />
      ) : null}

      <div className="space-y-1 text-xs">
        <div className="font-medium text-sm">{attachment.fileName}</div>
        <div className="text-muted-foreground">
          {attachment.llmImageUrl
            ? "已发送给多模态模型"
            : attachment.ocr?.status === "ready"
              ? "OCR 已完成"
              : attachment.ocr?.status === "error"
                ? `OCR 失败: ${attachment.ocr.error || "未知错误"}`
                : "OCR 未完成"}
        </div>
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
      </div>
    </div>
  );
}

function SourceUrlCard({ title, url }: { title?: string; url: string }) {
  return (
    <div className="bg-background/70 rounded-lg border px-3 py-2 text-xs">
      <div className="text-muted-foreground">来源链接</div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-primary break-all underline underline-offset-4"
      >
        {title || url}
      </a>
    </div>
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
    <div className="bg-background/70 rounded-lg border px-3 py-2 text-xs">
      <div className="text-muted-foreground">来源文档</div>
      <div className="font-medium">{title}</div>
      <div className="text-muted-foreground break-all">
        {filename || mediaType}
      </div>
    </div>
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
      <div className="bg-background/70 space-y-2 rounded-lg border px-3 py-2 text-xs">
        <img
          src={url}
          alt={filename || mediaType}
          className="max-h-72 w-full rounded-md object-contain"
        />
        <div className="text-muted-foreground break-all">
          {filename || mediaType}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background/70 rounded-lg border px-3 py-2 text-xs">
      <div className="text-muted-foreground">文件</div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-primary break-all underline underline-offset-4"
      >
        {filename || url}
      </a>
      <div className="text-muted-foreground break-all">{mediaType}</div>
    </div>
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

export function MessageBubble({
  message,
  isStreaming = false,
  onToolApproval,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
  onToolApproval: ToolApprovalHandler;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[90%] space-y-2",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-lg py-2 text-sm",
            isUser
              ? "bg-primary text-primary-foreground px-3"
              : "text-foreground pl-2",
          )}
        >
          {message.parts.map((part, i) => {
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
                <ChatMarkdown
                  key={key}
                  content={part.text}
                  isStreaming={isStreaming}
                />
              );
            }
            if (isImageAttachmentPart(part)) {
              return <AttachmentCard key={key} attachment={part.data} />;
            }
            if (part.type === "reasoning") {
              return <ReasoningBlock key={key} part={part} />;
            }
            if (part.type === "step-start") {
              return (
                <div
                  key={key}
                  className="my-2 border-t border-dashed border-border"
                />
              );
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
              return (
                <div key={key} className="mt-2 first:mt-0">
                  <DynamicToolCard
                    part={toolPart}
                    onApproval={onToolApproval}
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
