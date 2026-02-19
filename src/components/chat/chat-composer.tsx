import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AI_MODELS, type AIModelId } from "@/lib/ai-models";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  modelId: AIModelId;
  onModelChange: (id: AIModelId) => void;
  onSubmit: (text: string) => boolean;
  disabled?: boolean;
  placeholder?: string;
  topActions?: ReactNode;
  inputActions?: ReactNode;
}

export function ChatComposer({
  modelId,
  onModelChange,
  onSubmit,
  disabled = false,
  placeholder = "输入消息... (Enter 发送, Shift+Enter 换行)",
  topActions,
  inputActions,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = input.trim().length > 0 && !disabled;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || disabled) return;
    if (onSubmit(text)) {
      setInput("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={modelId}
          onValueChange={(val) => {
            onModelChange(val as AIModelId);
          }}
        >
          <SelectTrigger size="sm" className="w-fit min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_MODELS.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {topActions}
      </div>

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 rounded-lg border bg-transparent px-3 py-2 text-sm transition-colors focus-visible:ring-[3px] placeholder:text-muted-foreground flex-1 resize-none outline-none disabled:cursor-not-allowed disabled:opacity-50",
            "field-sizing-content min-h-9 max-h-32",
          )}
        />
        {inputActions}
        <Button onClick={handleSubmit} disabled={!canSend} size="default">
          发送
        </Button>
      </div>
    </div>
  );
}
