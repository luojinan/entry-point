import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

export function ChatMarkdown({
  content,
  isStreaming = false,
  className,
}: {
  content: string;
  isStreaming?: boolean;
  className?: string;
}) {
  return (
    <Streamdown
      className={cn(
        "min-w-0 break-words text-sm leading-6",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
        className,
      )}
      dir="auto"
      mode={isStreaming ? "streaming" : "static"}
      animated={isStreaming}
      isAnimating={isStreaming}
    >
      {content}
    </Streamdown>
  );
}
