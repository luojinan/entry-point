export type RuntimeEnv = Record<string, string | undefined> | undefined;

function readEnvValue(env: RuntimeEnv, key: string): string | undefined {
  return env?.[key] ?? process.env[key];
}

export function getRequestEnv(context: unknown): RuntimeEnv {
  const cloudflare = (
    context as { cloudflare?: { env?: RuntimeEnv } } | undefined
  )?.cloudflare;
  return cloudflare?.env;
}

export function getRuntimeEnvValue(
  env: RuntimeEnv,
  key: string,
): string | undefined {
  return readEnvValue(env, key)?.trim();
}

export function getRequiredRuntimeEnvValue(
  env: RuntimeEnv,
  keys: string | string[],
): string {
  const candidates = Array.isArray(keys) ? keys : [keys];

  for (const key of candidates) {
    const value = getRuntimeEnvValue(env, key);
    if (value) {
      return value;
    }
  }

  throw new Error(
    `Missing required environment variable: ${candidates.join(" or ")}`,
  );
}
