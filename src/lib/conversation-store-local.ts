import type { UIMessage } from "ai";
import type {
  Conversation,
  ConversationStore,
  ConversationWithMessages,
} from "./conversation-store";

const STORAGE_KEY = "chat-conversations";

interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

function readAll(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredConversation[];
  } catch {
    return [];
  }
}

function writeAll(conversations: StoredConversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // storage full or unavailable
  }
}

export function createLocalConversationStore(): ConversationStore {
  return {
    listConversations(): Conversation[] {
      return readAll()
        .map(({ messages: _, ...rest }) => rest)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    getConversation(id: string): ConversationWithMessages | null {
      const all = readAll();
      const found = all.find((c) => c.id === id);
      return found ?? null;
    },

    createConversation(title?: string): Conversation {
      const now = Date.now();
      const conversation: StoredConversation = {
        id: crypto.randomUUID(),
        title: title ?? "新对话",
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      const all = readAll();
      all.unshift(conversation);
      writeAll(all);
      const { messages: _, ...rest } = conversation;
      return rest;
    },

    updateConversation(
      id: string,
      updates: Partial<Pick<Conversation, "title">>,
    ) {
      const all = readAll();
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) return;
      Object.assign(all[idx], updates, { updatedAt: Date.now() });
      writeAll(all);
    },

    deleteConversation(id: string) {
      const all = readAll();
      writeAll(all.filter((c) => c.id !== id));
    },

    saveMessages(id: string, messages: UIMessage[]) {
      const all = readAll();
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) return;
      all[idx].messages = messages;
      all[idx].updatedAt = Date.now();
      writeAll(all);
    },
  };
}
