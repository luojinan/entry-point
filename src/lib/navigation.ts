import type { supabase } from "@/lib/supabase-client";

export type NavigationLinkRow = {
  id: number;
  title: string;
  url: string;
  inserted_at: string | null;
};

type SupabaseBrowserClient = typeof supabase;

const NAVIGATION_TABLE = "navigation_links";

export const NAVIGATION_LINKS_QUERY_KEY = ["navigation", "links"] as const;

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
