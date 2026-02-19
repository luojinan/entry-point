import type { UIMessage } from "ai";
import { useCallback, useMemo, useState } from "react";
import type { Conversation } from "@/lib/conversation-store";
import { createLocalConversationStore } from "@/lib/conversation-store-local";

const store = createLocalConversationStore();

export function useConversationStore() {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    store.listConversations(),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => conversations[0]?.id ?? null,
  );

  const refresh = useCallback(() => {
    setConversations(store.listConversations());
  }, []);

  const createConversation = useCallback(() => {
    const conv = store.createConversation();
    refresh();
    setActiveId(conv.id);
    return conv;
  }, [refresh]);

  const deleteConversation = useCallback(
    (id: string) => {
      store.deleteConversation(id);
      refresh();
      if (activeId === id) {
        const remaining = store.listConversations();
        setActiveId(remaining[0]?.id ?? null);
      }
    },
    [activeId, refresh],
  );

  const switchConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const saveMessages = useCallback((id: string, messages: UIMessage[]) => {
    store.saveMessages(id, messages);
  }, []);

  const updateTitle = useCallback(
    (id: string, title: string) => {
      store.updateConversation(id, { title });
      refresh();
    },
    [refresh],
  );

  const loadMessages = useCallback((id: string): UIMessage[] => {
    const conv = store.getConversation(id);
    return conv?.messages ?? [];
  }, []);

  return useMemo(
    () => ({
      conversations,
      activeId,
      createConversation,
      deleteConversation,
      switchConversation,
      saveMessages,
      updateTitle,
      loadMessages,
    }),
    [
      conversations,
      activeId,
      createConversation,
      deleteConversation,
      switchConversation,
      saveMessages,
      updateTitle,
      loadMessages,
    ],
  );
}
