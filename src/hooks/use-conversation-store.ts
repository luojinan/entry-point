import { useCallback, useMemo, useState } from "react";

import type { ChatMessage } from "@/lib/chat-message";
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

  const saveMessages = useCallback((id: string, messages: ChatMessage[]) => {
    store.saveMessages(id, messages);
  }, []);

  const updateTitle = useCallback(
    (id: string, title: string) => {
      store.updateConversation(id, { title });
      refresh();
    },
    [refresh],
  );

  const saveSelectedSkillIds = useCallback(
    (id: string, selectedSkillIds: string[]) => {
      store.updateConversation(id, { selectedSkillIds });
      refresh();
    },
    [refresh],
  );

  const loadMessages = useCallback((id: string): ChatMessage[] => {
    const conv = store.getConversation(id);
    return conv?.messages ?? [];
  }, []);

  const loadSelectedSkillIds = useCallback((id: string): string[] => {
    const conv = store.getConversation(id);
    return conv?.selectedSkillIds ?? [];
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
      saveSelectedSkillIds,
      loadSelectedSkillIds,
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
      saveSelectedSkillIds,
      loadSelectedSkillIds,
    ],
  );
}
