import type { ChatMessage } from "./chat-message";
import type {
  Conversation,
  ConversationStore,
  ConversationWithMessages,
} from "./conversation-store";
import { MAX_SELECTED_SKILLS, skillIdSchema, uniqueSkillIds } from "./skills";

const STORAGE_KEY = "chat-conversations";

interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  selectedSkillIds: string[];
  messages: ChatMessage[];
}

function readAll(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeStoredConversation)
      .filter((value): value is StoredConversation => value !== null);
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
        selectedSkillIds: [],
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
      updates: Partial<Pick<Conversation, "title" | "selectedSkillIds">>,
    ) {
      const all = readAll();
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) {
        return;
      }

      if (typeof updates.title === "string") {
        all[idx].title = updates.title;
      }
      if (Array.isArray(updates.selectedSkillIds)) {
        all[idx].selectedSkillIds = sanitizeSkillIds(updates.selectedSkillIds);
      }
      all[idx].updatedAt = Date.now();
      writeAll(all);
    },

    deleteConversation(id: string) {
      const all = readAll();
      writeAll(all.filter((c) => c.id !== id));
    },

    saveMessages(id: string, messages: ChatMessage[]) {
      const all = readAll();
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) {
        return;
      }
      all[idx].messages = messages;
      all[idx].updatedAt = Date.now();
      writeAll(all);
    },
  };
}

function normalizeStoredConversation(
  value: unknown,
): StoredConversation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number" ||
    !Array.isArray(record.messages)
  ) {
    return null;
  }

  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messages: record.messages as ChatMessage[],
    selectedSkillIds: sanitizeSkillIds(record.selectedSkillIds),
  };
}

function sanitizeSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueSkillIds(
    value
      .filter((item): item is string => typeof item === "string")
      .filter((item) => skillIdSchema.safeParse(item).success),
  ).slice(0, MAX_SELECTED_SKILLS);
}
