import type { AIModelOption } from "@/lib/ai-models";
import {
  createSupabaseServerClient,
  type RuntimeEnv,
} from "@/lib/supabase-server";

const LLM_MODEL_CONFIGS_TABLE = "llm_model_configs";

interface LLMModelConfigRow {
  id: string;
  provider_code: string;
  provider_name: string;
  model_id: string;
  model_label: string | null;
  protocol: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
  is_default: boolean;
  sort_order: number | null;
  created_at?: string;
}

export interface ResolvedLLMConfig {
  id: string;
  providerCode: string;
  providerName: string;
  modelId: string;
  label: string;
  protocol: string;
  baseURL: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
}

function mapRowToResolvedConfig(row: LLMModelConfigRow): ResolvedLLMConfig {
  return {
    id: row.id,
    providerCode: row.provider_code,
    providerName: row.provider_name,
    modelId: row.model_id,
    label: row.model_label?.trim() || row.model_id,
    protocol: row.protocol,
    baseURL: row.base_url,
    apiKey: row.api_key,
    enabled: row.enabled,
    isDefault: row.is_default,
  };
}

function mapResolvedConfigToOption(config: ResolvedLLMConfig): AIModelOption {
  return {
    id: config.id,
    label: config.label,
    providerLabel: config.providerName,
    modelId: config.modelId,
    isDefault: config.isDefault,
  };
}

function createLLMConfigSupabaseClient(env: RuntimeEnv) {
  return createSupabaseServerClient(env);
}

async function listRemoteConfigs(
  env: RuntimeEnv,
): Promise<ResolvedLLMConfig[]> {
  const supabase = createLLMConfigSupabaseClient(env);
  const { data, error } = await supabase
    .from(LLM_MODEL_CONFIGS_TABLE)
    .select(
      "id, provider_code, provider_name, model_id, model_label, protocol, base_url, api_key, enabled, is_default, sort_order, created_at",
    )
    .eq("enabled", true)
    .order("is_default", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load llm model configs: ${error.message}`);
  }

  return ((data ?? []) as LLMModelConfigRow[]).map(mapRowToResolvedConfig);
}

export async function listChatModelOptions(
  env: RuntimeEnv,
): Promise<AIModelOption[]> {
  const configs = await listRemoteConfigs(env);
  return configs.map(mapResolvedConfigToOption);
}

export async function getChatModelConfig(
  env: RuntimeEnv,
  selectedModelId?: string,
): Promise<ResolvedLLMConfig> {
  const configs = await listRemoteConfigs(env);

  if (selectedModelId) {
    const selected = configs.find((config) => config.id === selectedModelId);
    if (selected) {
      return selected;
    }
  }

  const defaultConfig = configs.find((config) => config.isDefault);
  if (defaultConfig) {
    return defaultConfig;
  }

  if (configs[0]) {
    return configs[0];
  }

  throw new Error(
    "No available LLM model configuration. Create enabled rows in llm_model_configs.",
  );
}
