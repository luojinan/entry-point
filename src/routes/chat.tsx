import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import type { DynamicToolUIPart } from "ai";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversationLayout } from "@/components/chat/chat-conversation-layout";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { MessageScroller } from "@/components/ui/message-scroller";
import { useChatSession } from "@/hooks/use-chat-session";
import { useConversationStore } from "@/hooks/use-conversation-store";
import type { AIModelId, AIModelOption } from "@/lib/ai-models";
import type { ChatMessage } from "@/lib/chat-message";

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

interface PendingAskUserQuestion {
  approvalId: string;
  input: unknown;
}

async function loadModelOptions(): Promise<AIModelOption[]> {
  const response = await fetch("/api/ai-models");
  const payload = (await response.json()) as ApiEnvelope<AIModelOption[]>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "加载模型失败");
  }

  if (payload.data.length === 0) {
    throw new Error("未查询到可用模型，请先在数据库中配置 llm_model_configs");
  }

  return payload.data;
}

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

function ChatPage() {
  const store = useConversationStore();
  const [modelOptions, setModelOptions] = useState<AIModelOption[]>([]);
  const [modelId, setModelId] = useState<AIModelId>("");
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncModelOptions() {
      try {
        const models = await loadModelOptions();
        if (cancelled) {
          return;
        }

        setModelOptions(models);
        setModelId((current) => {
          if (models.some((option) => option.id === current)) {
            return current;
          }
          return (
            models.find((option) => option.isDefault)?.id ?? models[0]?.id ?? ""
          );
        });
        setModelLoadError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setModelOptions([]);
        setModelId("");
        setModelLoadError(
          error instanceof Error ? error.message : "加载模型失败",
        );
      }
    }

    void syncModelOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ChatConversationLayout
      conversations={store.conversations}
      activeId={store.activeId}
      onNew={store.createConversation}
      onSwitch={store.switchConversation}
      onDelete={store.deleteConversation}
    >
      {store.activeId ? (
        <ChatSession
          key={store.activeId}
          conversationId={store.activeId}
          loadMessages={store.loadMessages}
          loadSelectedSkillIds={store.loadSelectedSkillIds}
          saveMessages={store.saveMessages}
          saveSelectedSkillIds={store.saveSelectedSkillIds}
          updateTitle={store.updateTitle}
          modelId={modelId}
          modelOptions={modelOptions}
          modelLoadError={modelLoadError}
          onModelChange={setModelId}
        />
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          <Button variant="outline" onClick={store.createConversation}>
            开始新对话
          </Button>
        </div>
      )}
    </ChatConversationLayout>
  );
}

function ChatSession({
  conversationId,
  loadMessages,
  loadSelectedSkillIds,
  saveMessages,
  saveSelectedSkillIds,
  updateTitle,
  modelId,
  modelOptions,
  modelLoadError,
  onModelChange,
}: {
  conversationId: string;
  loadMessages: (id: string) => ChatMessage[];
  loadSelectedSkillIds: (id: string) => string[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  saveSelectedSkillIds: (id: string, selectedSkillIds: string[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  modelLoadError: string | null;
  onModelChange: (id: AIModelId) => void;
}) {
  const [initialMessages] = useState<ChatMessage[]>(() =>
    loadMessages(conversationId),
  );
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(() =>
    loadSelectedSkillIds(conversationId),
  );
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  function handleSelectedSkillIdsChange(nextSkillIds: string[]) {
    setSelectedSkillIds(nextSkillIds);
    saveSelectedSkillIds(conversationId, nextSkillIds);
  }

  return (
    <ChatSessionInner
      conversationId={conversationId}
      initialMessages={initialMessages}
      selectedSkillIds={selectedSkillIds}
      onSelectedSkillIdsChange={handleSelectedSkillIdsChange}
      thinkingEnabled={thinkingEnabled}
      onThinkingEnabledChange={setThinkingEnabled}
      saveMessages={saveMessages}
      updateTitle={updateTitle}
      modelId={modelId}
      modelOptions={modelOptions}
      modelLoadError={modelLoadError}
      onModelChange={onModelChange}
    />
  );
}

function ChatSessionInner({
  conversationId,
  initialMessages,
  selectedSkillIds,
  onSelectedSkillIdsChange,
  thinkingEnabled,
  onThinkingEnabledChange,
  saveMessages,
  updateTitle,
  modelId,
  modelOptions,
  modelLoadError,
  onModelChange,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  selectedSkillIds: string[];
  onSelectedSkillIdsChange: (skillIds: string[]) => void;
  thinkingEnabled: boolean;
  onThinkingEnabledChange: (enabled: boolean) => void;
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  modelLoadError: string | null;
  onModelChange: (id: AIModelId) => void;
}) {
  const {
    messages,
    error,
    addToolApprovalResponse,
    isStreaming,
    isLoading,
    submitText,
    editUserMessage,
  } = useChatSession({
    conversationId,
    initialMessages,
    saveMessages,
    updateTitle,
    modelId,
    selectedSkillIds,
    thinkingEnabled,
  });

  const lastMessage = messages[messages.length - 1];
  const pendingAskUserQuestion = findPendingAskUserQuestion(messages);
  const showStreamingPlaceholder =
    isStreaming &&
    (!lastMessage ||
      lastMessage.role !== "assistant" ||
      !lastMessage.parts.some((part) => part.type !== "step-start"));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden p-2 sm:p-6">
      <MessageScroller.Provider autoScroll defaultScrollPosition="end">
        <MessageScroller.Root className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <MessageScroller.Viewport className="min-h-0 flex-1 overflow-y-auto">
            <MessageScroller.Content className="flex min-h-full flex-col gap-4 py-4">
              {messages.length === 0 && (
                <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                  发送消息开始对话
                </div>
              )}

              {messages.map((message, index) => (
                <MessageScroller.Item
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user" || index === 0}
                >
                  <MessageBubble
                    message={message}
                    isStreaming={
                      isStreaming &&
                      message.id === lastMessage?.id &&
                      message.role === "assistant"
                    }
                    onToolApproval={addToolApprovalResponse}
                    onEdit={editUserMessage}
                    editDisabled={isStreaming || isLoading}
                  />
                </MessageScroller.Item>
              ))}

              {(isLoading || showStreamingPlaceholder) && (
                <MessageScroller.Item messageId="streaming-placeholder">
                  <MessageBubble
                    message={{
                      id: "streaming-placeholder",
                      role: "assistant",
                      parts: [{ type: "text", text: "" }],
                    }}
                    isStreaming
                    onToolApproval={addToolApprovalResponse}
                    editDisabled
                  />
                </MessageScroller.Item>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error.message || "请求失败，请重试"}
                </div>
              )}

              {modelLoadError && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
                  {modelLoadError}
                </div>
              )}
            </MessageScroller.Content>
          </MessageScroller.Viewport>

          <MessageScroller.Button
            className="absolute bottom-2 left-1/2 z-10 flex size-11 -translate-x-1/2 items-center justify-center rounded-full border bg-background shadow-md transition-opacity inert:pointer-events-none inert:opacity-0"
            aria-label="滚动到底部"
            title="滚动到底部"
          >
            <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2.2} />
          </MessageScroller.Button>
        </MessageScroller.Root>
      </MessageScroller.Provider>

      <div className="sticky bottom-0 z-10 -mx-2 bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:-mx-6 sm:px-6">
        <ChatComposer
          conversationId={conversationId}
          modelId={modelId}
          modelOptions={modelOptions}
          onModelChange={onModelChange}
          onSubmit={submitText}
          pendingAskUserQuestion={pendingAskUserQuestion}
          onAskUserQuestionSubmit={addToolApprovalResponse}
          thinkingEnabled={thinkingEnabled}
          onThinkingEnabledChange={onThinkingEnabledChange}
          selectedSkillIds={selectedSkillIds}
          onSelectedSkillIdsChange={onSelectedSkillIdsChange}
          disabled={isStreaming || isLoading}
        />
      </div>
    </div>
  );
}

function findPendingAskUserQuestion(
  messages: ChatMessage[],
): PendingAskUserQuestion | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") {
      continue;
    }

    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex--
    ) {
      const part = message.parts[partIndex] as Partial<DynamicToolUIPart> & {
        type?: string;
        approval?: { id?: string };
      };
      const toolName =
        part.type === "dynamic-tool"
          ? part.toolName
          : part.type === "tool-AskUserQuestion"
            ? "AskUserQuestion"
            : null;

      if (
        toolName === "AskUserQuestion" &&
        part.state === "approval-requested" &&
        part.approval?.id
      ) {
        return {
          approvalId: part.approval.id,
          input: part.input,
        };
      }
    }
  }

  return null;
}
