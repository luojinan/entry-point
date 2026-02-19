import { DynamicToolCard } from "@/components/chat/dynamic-tool-card";
import { ReasoningBlock } from "@/components/chat/reasoning-block";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/routes/api/chat";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] space-y-2",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
          )}
        >
          {message.parts.map((part, i) => {
            const key = `${message.id}-${i}`;
            switch (part.type) {
              case "text":
                return (
                  <div key={key} className="whitespace-pre-wrap">
                    {part.text}
                  </div>
                );
              case "reasoning":
                return <ReasoningBlock key={key} part={part} />;
              case "dynamic-tool":
                return (
                  <div key={key} className="mt-2 first:mt-0">
                    <DynamicToolCard part={part} />
                  </div>
                );
              default:
                return null;
            }
          })}
        </div>
      </div>
    </div>
  );
}
