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
type ToolApprovalHandler = (opts: {
  id: string;
  approved: boolean;
  reason?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
}) => void | PromiseLike<void>;

interface UseChatSessionOptions {
  conversationId: string;
  initialMessages: ChatMessage[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  selectedSkillIds?: string[];
  thinkingEnabled?: boolean;
}

export function useChatSession({
  conversationId,
  initialMessages,
  saveMessages,
  updateTitle,
  modelId,
  selectedSkillIds = [],
  thinkingEnabled = false,
}: UseChatSessionOptions) {
  const titleUpdatedRef = useRef(initialMessages.length > 0);
  const modelIdRef = useRef(modelId);
  const selectedSkillIdsRef = useRef(selectedSkillIds);
  const thinkingEnabledRef = useRef(thinkingEnabled);
  const addToolApprovalResponseRef = useRef<
    ((opts: { id: string; approved: boolean; reason?: string }) => void) | null
  >(null);
  modelIdRef.current = modelId;
  selectedSkillIdsRef.current = selectedSkillIds;
  thinkingEnabledRef.current = thinkingEnabled;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          model: modelIdRef.current,
          skillIds: selectedSkillIdsRef.current,
          thinkingEnabled: thinkingEnabledRef.current,
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, addToolApprovalResponse } =
    useChat<ChatMessage>({
      id: conversationId,
      messages: initialMessages,
      transport,
      sendAutomaticallyWhen: (options) =>
        lastAssistantMessageIsCompleteWithApprovalResponses(options),
    });
  addToolApprovalResponseRef.current = addToolApprovalResponse;

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

  const handleToolApproval = useCallback<ToolApprovalHandler>(async (opts) => {
    addToolApprovalResponseRef.current?.({
      id: opts.id,
      approved: opts.approved,
      reason: opts.reason,
    });
  }, []);

  return {
    messages,
    status,
    error,
    addToolApprovalResponse: handleToolApproval,
    isStreaming,
    isLoading,
    submitText,
  };
}
