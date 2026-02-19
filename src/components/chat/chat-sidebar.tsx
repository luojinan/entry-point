import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/conversation-store";
import { cn } from "@/lib/utils";
import { DeleteConversationDialog } from "./delete-conversation-dialog";

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}

export function ChatSidebar({
  conversations,
  activeId,
  onNew,
  onSwitch,
  onDelete,
  onClose,
}: ChatSidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  const handleSwitch = (id: string) => {
    onSwitch(id);
    onClose?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button variant="outline" className="w-full" onClick={onNew}>
          <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
          新对话
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">
            暂无对话
          </p>
        )}

        {conversations.map((conv) => (
          <button
            key={conv.id}
            type="button"
            onClick={() => {
              handleSwitch(conv.id);
            }}
            className={cn(
              "group relative flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors",
              conv.id === activeId
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-muted text-foreground",
            )}
          >
            <span className="truncate pr-6">{conv.title}</span>
            <span
              role="button"
              tabIndex={0}
              className="absolute right-2 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(conv);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setDeleteTarget(conv);
                }
              }}
            >
              <HugeiconsIcon
                icon={Delete02Icon}
                className="text-muted-foreground hover:text-destructive size-4"
              />
            </span>
          </button>
        ))}
      </div>

      <DeleteConversationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) {
            onDelete(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        title={deleteTarget?.title ?? ""}
      />
    </div>
  );
}
