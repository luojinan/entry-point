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
import type { SkillSummary } from "@/lib/skills";

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

async function loadSkillOptions(): Promise<SkillSummary[]> {
  const response = await fetch("/api/skills");
  const payload = (await response.json()) as ApiEnvelope<SkillSummary[]>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "加载 skills 失败");
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
  const [skillOptions, setSkillOptions] = useState<SkillSummary[]>([]);
  const [skillLoadError, setSkillLoadError] = useState<string | null>(null);
  const [isLoadingSkills, setIsLoadingSkills] = useState(true);

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

  useEffect(() => {
    let cancelled = false;

    async function syncSkillOptions() {
      try {
        setIsLoadingSkills(true);
        const skills = await loadSkillOptions();
        if (cancelled) {
          return;
        }

        setSkillOptions(skills);
        setSkillLoadError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSkillOptions([]);
        setSkillLoadError(
          error instanceof Error ? error.message : "加载 skills 失败",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingSkills(false);
        }
      }
    }

    void syncSkillOptions();

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
          skillOptions={skillOptions}
          skillLoadError={skillLoadError}
          isLoadingSkills={isLoadingSkills}
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
  skillOptions,
  skillLoadError,
  isLoadingSkills,
  onModelChange,
}: {
  conversationId: string;
  loadMessages: (id: string) => ChatMessage[];
  loadSelectedSkillIds: (id: string) => string[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  saveSelectedSkillIds: (id: string, skillIds: string[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  modelLoadError: string | null;
  skillOptions: SkillSummary[];
  skillLoadError: string | null;
  isLoadingSkills: boolean;
  onModelChange: (id: AIModelId) => void;
}) {
  const [initialMessages] = useState<ChatMessage[]>(() =>
    loadMessages(conversationId),
  );
  const [initialSelectedSkillIds] = useState<string[]>(() =>
    loadSelectedSkillIds(conversationId),
  );

  return (
    <ChatSessionInner
      conversationId={conversationId}
      initialMessages={initialMessages}
      initialSelectedSkillIds={initialSelectedSkillIds}
      saveMessages={saveMessages}
      saveSelectedSkillIds={saveSelectedSkillIds}
      updateTitle={updateTitle}
      modelId={modelId}
      modelOptions={modelOptions}
      modelLoadError={modelLoadError}
      skillOptions={skillOptions}
      skillLoadError={skillLoadError}
      isLoadingSkills={isLoadingSkills}
      onModelChange={onModelChange}
    />
  );
}

function ChatSessionInner({
  conversationId,
  initialMessages,
  initialSelectedSkillIds,
  saveMessages,
  saveSelectedSkillIds,
  updateTitle,
  modelId,
  modelOptions,
  modelLoadError,
  skillOptions,
  skillLoadError,
  isLoadingSkills,
  onModelChange,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  initialSelectedSkillIds: string[];
  saveMessages: (id: string, messages: ChatMessage[]) => void;
  saveSelectedSkillIds: (id: string, skillIds: string[]) => void;
  updateTitle: (id: string, title: string) => void;
  modelId: AIModelId;
  modelOptions: AIModelOption[];
  modelLoadError: string | null;
  skillOptions: SkillSummary[];
  skillLoadError: string | null;
  isLoadingSkills: boolean;
  onModelChange: (id: AIModelId) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    initialSelectedSkillIds,
  );
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
    selectedSkillIds,
  });

  const handleSelectedSkillIdsChange = (skillIds: string[]) => {
    setSelectedSkillIds(skillIds);
    saveSelectedSkillIds(conversationId, skillIds);
  };

  const lastMessage = messages[messages.length - 1];
  const lastMessagePartsLength = lastMessage?.parts.length ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message changes
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
          skillOptions={skillOptions}
          selectedSkillIds={selectedSkillIds}
          onSelectedSkillIdsChange={handleSelectedSkillIdsChange}
          skillLoadError={skillLoadError}
          isLoadingSkills={isLoadingSkills}
          onSubmit={submitText}
          disabled={isStreaming || isLoading}
        />
      </div>
    </div>
  );
}
