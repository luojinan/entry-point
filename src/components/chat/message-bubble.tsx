import type { DynamicToolUIPart } from "ai";
import { DynamicToolCard } from "@/components/chat/dynamic-tool-card";
import { ReasoningBlock } from "@/components/chat/reasoning-block";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/routes/api/chat";

type ToolApprovalHandler = (opts: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

/**
 * Static tool parts (created by `tool()`) have `type: "tool-${name}"`
 * instead of `type: "dynamic-tool"`. Normalize them so DynamicToolCard
 * can handle both uniformly.
 */
function asToolPart(part: { type: string }): DynamicToolUIPart | null {
  if (part.type === "dynamic-tool") return part as DynamicToolUIPart;
  if (part.type.startsWith("tool-")) {
    const toolName = part.type.slice("tool-".length);
    return { ...part, type: "dynamic-tool", toolName } as DynamicToolUIPart;
  }
  return null;
}

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
            if (part.type === "text") {
              return (
                <div key={key} className="whitespace-pre-wrap">
                  {part.text}
                </div>
              );
            }
            if (part.type === "reasoning") {
              return <ReasoningBlock key={key} part={part} />;
            }
            const toolPart = asToolPart(part);
            if (toolPart) {
              return (
                <div key={key} className="mt-2 first:mt-0">
                  <DynamicToolCard
                    part={toolPart}
                    onApproval={onToolApproval}
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
