import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { AIModelId } from "@/lib/ai-models";
import {
  type ChatImageAttachment,
  type ChatMessage,
  createImageAttachmentPart,
} from "@/lib/chat-message";

interface UseChatSessionOptions {
  conversationId: string;
  initialMessages: ChatMessage[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
}

export function useChatSession({
  conversationId,
  initialMessages,
  saveMessages,
  updateTitle,
  modelId,
}: UseChatSessionOptions) {
  const titleUpdatedRef = useRef(initialMessages.length > 0);
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          model: modelIdRef.current,
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, addToolApprovalResponse } =
    useChat<ChatMessage>({
      id: conversationId,
      messages: initialMessages,
      transport,
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  const isStreaming = status === "streaming";
  const isLoading = status === "submitted";
  const isReady = status === "ready";
  const messagesLength = messages.length;

  const saveMessagesRef = useRef(saveMessages);
  saveMessagesRef.current = saveMessages;

  useEffect(() => {
    if (messagesLength > 0 && isReady) {
      saveMessagesRef.current(conversationId, messages);
    }
  }, [conversationId, messages, messagesLength, isReady]);

  const updateTitleRef = useRef(updateTitle);
  updateTitleRef.current = updateTitle;

  const autoTitle = useCallback(
    (text: string) => {
      if (titleUpdatedRef.current) {
        return;
      }
      titleUpdatedRef.current = true;
      const title = text.length > 50 ? `${text.slice(0, 50)}…` : text;
      updateTitleRef.current(conversationId, title);
    },
    [conversationId],
  );

  const submitText = useCallback(
    (rawText: string, attachments: ChatImageAttachment[] = []) => {
      const text = rawText.trim();
      if ((!text && attachments.length === 0) || isStreaming || isLoading) {
        return false;
      }

      autoTitle(text || attachments[0]?.fileName || "图片对话");
      void sendMessage({
        parts: [
          ...attachments.map(createImageAttachmentPart),
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
      });
      return true;
    },
    [autoTitle, isLoading, isStreaming, sendMessage],
  );

  return {
    messages,
    status,
    error,
    addToolApprovalResponse,
    isStreaming,
    isLoading,
    submitText,
  };
}
