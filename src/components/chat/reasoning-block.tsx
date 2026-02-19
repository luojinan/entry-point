import type { ReasoningUIPart } from "ai";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function ReasoningBlock({ part }: { part: ReasoningUIPart }) {
  const [open, setOpen] = useState(false);
  const isStreaming = part.state === "streaming";

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        className={cn(
          "text-muted-foreground flex items-center gap-1 text-xs hover:underline",
          isStreaming && "animate-pulse",
        )}
      >
        <span>{open ? "▼" : "▶"}</span>
        <span>{isStreaming ? "思考中..." : "查看思考过程"}</span>
      </button>
      {open && (
        <div className="text-muted-foreground mt-1 border-l-2 border-border pl-3 text-xs whitespace-pre-wrap">
          {part.text}
        </div>
      )}
    </div>
  );
}
