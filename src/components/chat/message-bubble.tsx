import { DynamicToolCard } from "@/components/chat/dynamic-tool-card";
import { ReasoningBlock } from "@/components/chat/reasoning-block";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/routes/api/chat";

type ToolApprovalHandler = (opts: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

export function MessageBubble({
  message,
  onToolApproval,
}: {
  message: ChatMessage;
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
                    <DynamicToolCard part={part} onApproval={onToolApproval} />
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
