import type { ChatMessage } from "@/lib/chat-message";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationWithMessages extends Conversation {
  messages: ChatMessage[];
}

export interface ConversationStore {
  listConversations(): Conversation[];
  getConversation(id: string): ConversationWithMessages | null;
  createConversation(title?: string): Conversation;
  updateConversation(
    id: string,
    updates: Partial<Pick<Conversation, "title">>,
  ): void;
  deleteConversation(id: string): void;
  saveMessages(id: string, messages: ChatMessage[]): void;
}
