import { devToolsMiddleware } from "@ai-sdk/devtools";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel } from "ai";

import { getChatModelConfig } from "@/lib/server/llm-config";
import type { RuntimeEnv } from "@/lib/supabase-server";

export async function getModel(modelId?: string, env?: RuntimeEnv) {
  const config = await getChatModelConfig(env, modelId);

  if (config.protocol !== "openai_compatible") {
    throw new Error(`Unsupported LLM protocol: ${config.protocol}`);
  }

  const provider = createOpenAICompatible({
    name: config.providerCode,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const model = provider(config.modelId);

  if (import.meta.env.DEV) {
    return wrapLanguageModel({
      model,
      middleware: devToolsMiddleware(),
    });
  }

  return model;
}
