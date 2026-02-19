import { createFileRoute } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatConversationLayout } from "@/components/chat/chat-conversation-layout";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { useChatSession } from "@/hooks/use-chat-session";
import { useConversationStore } from "@/hooks/use-conversation-store";
import { AI_MODELS, type AIModelId } from "@/lib/ai-models";
import type { ChatMessage } from "./api/chat";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

function ChatPage() {
  const store = useConversationStore();
  const [modelId, setModelId] = useState<AIModelId>(AI_MODELS[0].id);

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
  onModelChange,
}: {
  conversationId: string;
  loadMessages: (id: string) => UIMessage[];
  saveMessages: (id: string, messages: UIMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
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
  onModelChange,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  saveMessages: (id: string, messages: UIMessage[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, lastMessagePartsLength]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden p-2 sm:p-6">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            发送消息开始对话
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
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
      </div>

      <ChatComposer
        modelId={modelId}
        onModelChange={onModelChange}
        onSubmit={submitText}
        disabled={isStreaming || isLoading}
      />
    </div>
  );
}
