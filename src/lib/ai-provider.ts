import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const provider = createOpenAICompatible({
  name: "custom-ai",
  apiKey: process.env.AI_API_KEY ?? "",
  baseURL: process.env.AI_BASE_URL ?? "",
});

export function getModel() {
  return provider(process.env.AI_MODEL ?? "gpt-4");
}
