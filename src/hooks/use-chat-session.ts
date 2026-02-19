import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AIModelId } from "@/lib/ai-models";
import type { ChatMessage } from "@/routes/api/chat";

interface UseChatSessionOptions {
  conversationId: string;
  initialMessages: ChatMessage[];
  saveMessages: (id: string, messages: UIMessage[]) => void;
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
        body: () => ({ model: modelIdRef.current }),
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
      if (titleUpdatedRef.current) return;
      titleUpdatedRef.current = true;
      const title = text.length > 50 ? `${text.slice(0, 50)}…` : text;
      updateTitleRef.current(conversationId, title);
    },
    [conversationId],
  );

  const submitText = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text || isStreaming || isLoading) return false;
      autoTitle(text);
      sendMessage({ text });
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
