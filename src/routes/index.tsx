import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchNavigationLinks,
  NAVIGATION_LINKS_QUERY_KEY,
} from "@/lib/navigation";
import { supabase } from "@/lib/supabase-client";

export const Route = createFileRoute("/")({ component: HomePage });

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "";
}

function HomePage() {
  const {
    isLoading: loading,
    data,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: NAVIGATION_LINKS_QUERY_KEY,
    queryFn: () => fetchNavigationLinks(supabase),
  });

  const links = data ?? [];
  const error = getErrorMessage(queryError);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            导航首页
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/components-demo"
              className="text-primary rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              打开组件示例页
            </Link>
            <Link
              to="/supabase"
              className="text-primary rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              打开 Supabase CRUD 示例
            </Link>
          </div>
        </header>

        {error && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                refetch();
              }}
            >
              重试
            </Button>
          </div>
        )}

        {loading && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="bg-card h-36 animate-pulse rounded-xl border"
              />
            ))}
          </section>
        )}

        {!loading && !error && links.length > 0 && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((item) => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
                <Card className="h-full border-border/70 bg-card/85 transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="break-words">{item.title}</CardTitle>
                    <CardDescription className="break-all text-xs">
                      {item.url}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </a>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
