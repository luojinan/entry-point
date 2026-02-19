export const AI_MODELS = [
  { id: "LongCat-Flash-Thinking-2601", label: "LongCat Flash Thinking" },
  { id: "LongCat-Flash-Chat", label: "LongCat Flash Chat" },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["id"];
