import { devToolsMiddleware } from "@ai-sdk/devtools";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";
import { AI_MODELS } from "./ai-models";

const provider = createOpenAICompatible({
  name: "custom-ai",
  apiKey: process.env.AI_API_KEY ?? "",
  baseURL: process.env.AI_BASE_URL ?? "",
});

export function getModel(modelId?: string) {
  const model = provider(modelId || process.env.AI_MODEL || AI_MODELS[0].id);

  if (import.meta.env.DEV) {
    return wrapLanguageModel({
      model,
      middleware: devToolsMiddleware(),
    });
  }

  return model;
}
