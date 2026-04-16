import { createClient } from "@supabase/supabase-js";

export type RuntimeEnv = Record<string, string | undefined> | undefined;

function readEnvValue(env: RuntimeEnv, key: string): string | undefined {
  return env?.[key] ?? process.env[key];
}

export function getRuntimeEnvValue(
  env: RuntimeEnv,
  key: string,
): string | undefined {
  return readEnvValue(env, key);
}

export function getRequestEnv(context: unknown): RuntimeEnv {
  const cloudflare = (
    context as { cloudflare?: { env?: RuntimeEnv } } | undefined
  )?.cloudflare;
  return cloudflare?.env;
}

export function getSupabaseServerConfig(env: RuntimeEnv) {
  const url =
    readEnvValue(env, "SUPABASE_URL") ?? readEnvValue(env, "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnvValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = readEnvValue(env, "VITE_SUPABASE_PUBLISHABLE_KEY");
  const key = serviceRoleKey ?? publishableKey;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase server configuration. Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY.",
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
