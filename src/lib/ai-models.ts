export const AI_MODELS = [
  { id: "mimo-v2-flash", label: "mimo-v2-flash" },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]["id"];
