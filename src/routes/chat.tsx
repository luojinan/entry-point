import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversationLayout } from "@/components/chat/chat-conversation-layout";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { useChatSession } from "@/hooks/use-chat-session";
import { useConversationStore } from "@/hooks/use-conversation-store";
import type { AIModelId, AIModelOption } from "@/lib/ai-models";
import type { ChatMessage } from "@/lib/chat-message";

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
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
          saveMessages={store.saveMessages}
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
  saveMessages,
  updateTitle,
  modelId,
  modelOptions,
  modelLoadError,
  onModelChange,
}: {
  conversationId: string;
  loadMessages: (id: string) => ChatMessage[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  modelLoadError: string | null;
  onModelChange: (id: AIModelId) => void;
}) {
  const [initialMessages] = useState<ChatMessage[]>(() =>
    loadMessages(conversationId),
  );

  return (
    <ChatSessionInner
      conversationId={conversationId}
      initialMessages={initialMessages}
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
  saveMessages,
  updateTitle,
  modelId,
  modelOptions,
  modelLoadError,
  onModelChange,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  modelLoadError: string | null;
  onModelChange: (id: AIModelId) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    error,
    addToolApprovalResponse,
    isStreaming,
    isLoading,
    submitText,
  } = useChatSession({
    conversationId,
    initialMessages,
    saveMessages,
    updateTitle,
    modelId,
  });

  const lastMessage = messages[messages.length - 1];
  const lastMessagePartsLength = lastMessage?.parts.length ?? 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, lastMessagePartsLength]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden p-2 sm:p-6">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 space-y-4 overflow-y-auto py-4"
      >
        {messages.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            发送消息开始对话
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={
              isStreaming &&
              message.id === lastMessage?.id &&
              message.role === "assistant"
            }
            onToolApproval={addToolApprovalResponse}
          />
        ))}

        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce [animation-delay:0.1s]">·</span>
                <span className="animate-bounce [animation-delay:0.2s]">·</span>
              </span>
            </div>
          </div>
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
      </div>

      <div className="sticky bottom-0 z-10 -mx-2 border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:-mx-6 sm:px-6">
        <ChatComposer
          conversationId={conversationId}
          modelId={modelId}
          modelOptions={modelOptions}
          onModelChange={onModelChange}
          onSubmit={submitText}
          disabled={isStreaming || isLoading}
        />
      </div>
    </div>
  );
}
