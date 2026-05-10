import { createClient } from "@supabase/supabase-js";

import {
  getRequestEnv,
  getRequiredRuntimeEnvValue,
  getRuntimeEnvValue,
  type RuntimeEnv,
} from "@/lib/runtime-env";

export type { RuntimeEnv } from "@/lib/runtime-env";
export { getRequestEnv, getRuntimeEnvValue };

export function getSupabaseServerConfig(env: RuntimeEnv) {
  const url = getRequiredRuntimeEnvValue(env, "SUPABASE_URL");
  const serviceRoleKey = getRuntimeEnvValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = getRuntimeEnvValue(env, "SUPABASE_PUBLISHABLE_KEY");
  const key = serviceRoleKey ?? publishableKey;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase server configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return {
    url,
    key,
    isServiceRole: Boolean(serviceRoleKey),
  };
}

export function createSupabaseServerClient(env: RuntimeEnv) {
  const { url, key } = getSupabaseServerConfig(env);

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
