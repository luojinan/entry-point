import { Menu02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/conversation-store";
import { ChatSidebar } from "./chat-sidebar";

interface ChatConversationLayoutProps {
  conversations: Conversation[];
  activeId: string | null;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  children: ReactNode;
}

export function ChatConversationLayout({
  conversations,
  activeId,
  onNew,
  onSwitch,
  onDelete,
  children,
}: ChatConversationLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeTitle = useMemo(() => {
    if (!activeId) return "AI Chat";
    return conversations.find((conversation) => conversation.id === activeId)
      ?.title;
  }, [activeId, conversations]);

  const handleNewConversation = () => {
    onNew();
    setSidebarOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="bg-sidebar hidden w-64 shrink-0 border-r md:block">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          onNew={handleNewConversation}
          onSwitch={onSwitch}
          onDelete={onDelete}
        />
      </aside>

      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => {
              setSidebarOpen(false);
            }}
            onKeyDown={() => {}}
            role="presentation"
          />
          <aside className="bg-sidebar fixed inset-y-0 left-0 z-50 w-64 border-r pt-[52px] md:hidden">
            <ChatSidebar
              conversations={conversations}
              activeId={activeId}
              onNew={handleNewConversation}
              onSwitch={onSwitch}
              onDelete={onDelete}
              onClose={() => {
                setSidebarOpen(false);
              }}
            />
          </aside>
        </>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => {
              setSidebarOpen(true);
            }}
          >
            <HugeiconsIcon icon={Menu02Icon} />
          </Button>
          <h1 className="truncate text-sm font-medium">
            {activeTitle ?? "AI Chat"}
          </h1>
        </header>
        {children}
      </div>
    </div>
  );
}
