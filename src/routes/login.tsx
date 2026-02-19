import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase-client";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: (search.redirect as string) ?? "/",
  }),
  beforeLoad: ({ context }) => {
    if (context.auth) {
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMagicLink = useMutation({
    mutationFn: async (emailValue: string) => {
      const emailRedirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}${redirectTo}`
          : undefined;

      const { error: err } = await supabase.auth.signInWithOtp({
        email: emailValue,
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });

      if (err) throw err;
    },
    onMutate: () => {
      setHint(null);
      setError(null);
    },
    onSuccess: () => {
      setHint("登录链接已发送到邮箱，请点击邮件中的链接完成登录。");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试。");
    },
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    sendMagicLink.mutate(trimmed);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>输入邮箱接收 Magic Link 完成登录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={sendMagicLink.isPending}
            />
            <Button type="submit" disabled={sendMagicLink.isPending}>
              发送登录链接
            </Button>
          </form>

          {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
