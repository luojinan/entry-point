import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "./api/chat";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
});

function ChatPage() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const isStreaming = status === "streaming";
  const isLoading = status === "submitted";

  const messagesLength = messages.length;
  const lastMessage = messages[messagesLength - 1];
  const lastMessagePartsLength = lastMessage?.parts.length ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesLength, lastMessagePartsLength]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isStreaming || isLoading) return;
    sendMessage({ text });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <main className="mx-auto flex h-[calc(100vh-52px)] w-full max-w-3xl flex-col p-4 sm:p-6">
      <div className="mb-3">
        <h1 className="text-lg font-semibold">AI Chat</h1>
        <p className="text-muted-foreground text-sm">
          支持工具调用：Supabase 数据库操作
        </p>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border p-4"
      >
        {messages.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            发送消息开始对话
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
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

      {/* Input area */}
      <div className="mt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          disabled={isStreaming || isLoading}
          rows={1}
          className={cn(
            "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 rounded-lg border bg-transparent px-3 py-2 text-sm transition-colors focus-visible:ring-[3px] placeholder:text-muted-foreground flex-1 resize-none outline-none disabled:cursor-not-allowed disabled:opacity-50",
            "field-sizing-content min-h-9 max-h-32",
          )}
        />
        <Button
          onClick={handleSubmit}
          disabled={!input.trim() || isStreaming || isLoading}
          size="default"
        >
          发送
        </Button>
      </div>
    </main>
  );
}
