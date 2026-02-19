import { redirect } from "@tanstack/react-router";
import { supabase } from "./supabase-client";

export type AuthUser = { id: string; email: string } | null;

export async function getAuthUser(): Promise<AuthUser> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? "" } : null;
}

export function requireAuth(options: {
  auth: AuthUser;
  redirectTo: string;
}): void {
  if (!options.auth) {
    throw redirect({
      to: "/login",
      search: { redirect: options.redirectTo },
    });
  }
}
