import type { supabase } from "@/lib/supabase-client";

export type NavigationLinkRow = {
  id: number;
  title: string;
  url: string;
  inserted_at: string | null;
};

type SupabaseBrowserClient = typeof supabase;

const NAVIGATION_TABLE = "navigation_links";
const NAVIGATION_LINKS_CACHE_KEY = "navigation-links-cache-v1";

export const NAVIGATION_LINKS_QUERY_KEY = ["navigation", "links"] as const;

function isNavigationLinkRow(value: unknown): value is NavigationLinkRow {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const row = value as Record<string, unknown>;

  return (
    typeof row.id === "number" &&
    typeof row.title === "string" &&
    typeof row.url === "string" &&
    (typeof row.inserted_at === "string" || row.inserted_at === null)
  );
}

export async function fetchNavigationLinks(supabase: SupabaseBrowserClient) {
  const { data, error } = await supabase
    .from(NAVIGATION_TABLE)
    .select("id, title, url, inserted_at")
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as NavigationLinkRow[];
}

export function readNavigationLinksCache() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const cachedValue = window.localStorage.getItem(NAVIGATION_LINKS_CACHE_KEY);
  if (!cachedValue) {
    return undefined;
  }

  try {
    const parsedValue: unknown = JSON.parse(cachedValue);
    if (!Array.isArray(parsedValue)) {
      return undefined;
    }

    if (!parsedValue.every((item) => isNavigationLinkRow(item))) {
      return undefined;
    }

    return parsedValue;
  } catch {
    return undefined;
  }
}

export function writeNavigationLinksCache(links: NavigationLinkRow[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(NAVIGATION_LINKS_CACHE_KEY, JSON.stringify(links));
}
