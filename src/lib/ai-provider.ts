import { devToolsMiddleware } from "@ai-sdk/devtools";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";

const provider = createOpenAICompatible({
  name: "custom-ai",
  apiKey: process.env.AI_API_KEY ?? "",
  baseURL: process.env.AI_BASE_URL ?? "",
});

export function getModel() {
  // return provider(process.env.AI_MODEL ?? "gpt-4");
  return wrapLanguageModel({
    model: provider(process.env.AI_MODEL ?? "gpt-4"),
    middleware: devToolsMiddleware(),
  });
}
