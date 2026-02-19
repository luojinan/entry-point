import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase-client";

export const Route = createFileRoute("/supabase")({
  beforeLoad: ({ context, location }) => {
    requireAuth({
      auth: context.auth,
      redirectTo: location.href,
    });
  },
  component: RouteComponent,
});

type TodoRow = {
  id: number;
  title: string;
  done: boolean;
  user_id: string | null;
  inserted_at: string | null;
};

type CurrentUser = {
  id: string;
  email: string | null;
};

const TABLE_NAME = "demo_todos";
const AUTH_USER_QUERY_KEY = ["supabase", "auth-user"] as const;
const TODOS_QUERY_KEY = ["supabase", "todos"] as const;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

function RouteComponent() {
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const userQuery = useQuery({
    queryKey: AUTH_USER_QUERY_KEY,
    queryFn: async (): Promise<CurrentUser | null> => {
      const { data, error } = await supabase.auth.getUser();

      if (error) {
        throw error;
      }

      const currentUser = data.user;
      return currentUser
        ? { id: currentUser.id, email: currentUser.email ?? null }
        : null;
    },
  });

  const {
    data: todosData,
    error: todosError,
    isPending: todosPending,
    isFetching: todosFetching,
    refetch: refetchTodos,
  } = useQuery({
    queryKey: TODOS_QUERY_KEY,
    queryFn: async (): Promise<TodoRow[]> => {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .select("id, title, done, user_id, inserted_at")
        .order("id", { ascending: false });

      if (error) {
        throw error;
      }

      return (data ?? []) as TodoRow[];
    },
  });

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      queryClient.setQueryData<CurrentUser | null>(
        AUTH_USER_QUERY_KEY,
        nextUser ? { id: nextUser.id, email: nextUser.email ?? null } : null,
      );
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const sendMagicLinkMutation = useMutation({
    mutationFn: async (email: string) => {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/supabase`
          : undefined;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });

      if (error) {
        throw error;
      }
    },
    onMutate: () => {
      setMessage(null);
      setAuthHint(null);
    },
    onSuccess: () => {
      setAuthHint("登录链接已发送到邮箱，请点击邮件中的链接完成登录。");
    },
    onError: (error) => {
      setMessage(getErrorMessage(error));
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }
    },
    onMutate: () => {
      setMessage(null);
      setAuthHint(null);
    },
    onSuccess: async () => {
      setAuthHint("已退出登录。");
      await queryClient.invalidateQueries({ queryKey: AUTH_USER_QUERY_KEY });
    },
    onError: (error) => {
      setMessage(getErrorMessage(error));
    },
  });

  const createTodoMutation = useMutation({
    mutationFn: async (title: string) => {
      const user = userQuery.data;
      if (!user) {
        throw new Error("请先登录后再新增 Todo。");
      }

      const { error } = await supabase
        .from(TABLE_NAME)
        .insert({ title, done: false, user_id: user.id });

      if (error) {
        throw error;
      }
    },
    onMutate: () => {
      setMessage(null);
    },
    onSuccess: async () => {
      setNewTitle("");
      await queryClient.invalidateQueries({ queryKey: TODOS_QUERY_KEY });
    },
    onError: (error) => {
      setMessage(getErrorMessage(error));
    },
  });

  const toggleTodoMutation = useMutation({
    mutationFn: async (row: TodoRow) => {
      const { error } = await supabase
        .from(TABLE_NAME)
        .update({ done: !row.done })
        .eq("id", row.id);

      if (error) {
        throw error;
      }
    },
    onMutate: () => {
      setMessage(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TODOS_QUERY_KEY });
    },
    onError: (error) => {
      setMessage(getErrorMessage(error));
    },
  });

  const saveTodoMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const { error } = await supabase
        .from(TABLE_NAME)
        .update({ title })
        .eq("id", id);

      if (error) {
        throw error;
      }
    },
    onMutate: () => {
      setMessage(null);
    },
    onSuccess: async () => {
      setEditingId(null);
      setEditingTitle("");
      await queryClient.invalidateQueries({ queryKey: TODOS_QUERY_KEY });
    },
    onError: (error) => {
      setMessage(getErrorMessage(error));
    },
  });

  const deleteTodoMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from(TABLE_NAME).delete().eq("id", id);

      if (error) {
        throw error;
      }
    },
    onMutate: () => {
      setMessage(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TODOS_QUERY_KEY });
    },
    onError: (error) => {
      setMessage(getErrorMessage(error));
    },
  });

  const authLoading =
    sendMagicLinkMutation.isPending || signOutMutation.isPending;
  const submitting =
    createTodoMutation.isPending ||
    toggleTodoMutation.isPending ||
    saveTodoMutation.isPending ||
    deleteTodoMutation.isPending;
  const loading = todosPending || todosFetching;
  const todos = todosData ?? [];
  const user = userQuery.data ?? null;
  const queryError = todosError ?? userQuery.error;
  const errorMessage =
    message ?? (queryError ? getErrorMessage(queryError) : null);

  const sendMagicLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = authEmail.trim();
    if (!email) {
      return;
    }

    sendMagicLinkMutation.mutate(email);
  };

  const signOut = () => {
    signOutMutation.mutate();
  };

  const createTodo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || !user) {
      return;
    }

    createTodoMutation.mutate(title);
  };

  const toggleTodo = (row: TodoRow) => {
    toggleTodoMutation.mutate(row);
  };

  const startEdit = (row: TodoRow) => {
    setEditingId(row.id);
    setEditingTitle(row.title);
  };

  const saveEdit = (id: number) => {
    const title = editingTitle.trim();
    if (!title) {
      return;
    }

    saveTodoMutation.mutate({ id, title });
  };

  const deleteTodo = (id: number) => {
    deleteTodoMutation.mutate(id);
  };

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Supabase CRUD Demo</CardTitle>
          <CardDescription>
            最简登录（Magic Link）+ CRUD。示例包含 `user_id`
            字段，但不做用户隔离。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="mb-2 font-medium">登录状态</p>
            {user ? (
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <p className="text-xs">
                  已登录: {user.email ?? "(no-email)"} · uid: {user.id}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={signOut}
                  disabled={authLoading}
                >
                  退出登录
                </Button>
              </div>
            ) : (
              <form
                className="flex flex-col gap-2 md:flex-row"
                onSubmit={sendMagicLink}
              >
                <Input
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="输入邮箱接收 magic link"
                  disabled={authLoading}
                />
                <Button type="submit" disabled={authLoading}>
                  发送登录链接
                </Button>
              </form>
            )}
            {authHint && (
              <p className="text-muted-foreground mt-2 text-xs">{authHint}</p>
            )}
          </div>

          <form className="flex gap-2" onSubmit={createTodo}>
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="新增一条 todo，例如：Read Supabase docs"
              disabled={!user || submitting}
            />
            <Button type="submit" disabled={!user || submitting}>
              新增
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading || submitting}
              onClick={() => {
                refetchTodos();
              }}
            >
              刷新
            </Button>
          </form>

          {errorMessage && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <div className="space-y-2">
            {loading && (
              <p className="text-muted-foreground text-sm">加载中...</p>
            )}
            {!loading && todos.length === 0 && (
              <p className="text-muted-foreground text-sm">暂无数据</p>
            )}
            {todos.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center"
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.done}
                    disabled={submitting}
                    onChange={() => toggleTodo(row)}
                  />
                  <span>完成</span>
                </label>

                <div className="flex-1">
                  {editingId === row.id ? (
                    <Input
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      disabled={submitting}
                    />
                  ) : (
                    <p
                      className={
                        row.done ? "text-muted-foreground line-through" : ""
                      }
                    >
                      {row.title}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs">
                    id: {row.id} · created:{" "}
                    {row.inserted_at
                      ? new Date(row.inserted_at).toLocaleString()
                      : "-"}{" "}
                    · user_id: {row.user_id ?? "-"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={row.done ? "secondary" : "outline"}>
                    {row.done ? "DONE" : "OPEN"}
                  </Badge>

                  {editingId === row.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => saveEdit(row.id)}
                        disabled={submitting}
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setEditingTitle("");
                        }}
                        disabled={submitting}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(row)}
                      disabled={submitting}
                    >
                      编辑
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteTodo(row.id)}
                    disabled={submitting}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-muted-foreground text-xs">
            文档:{" "}
            <a
              href="https://supabase.com/docs/reference/javascript"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Supabase JavaScript Reference
            </a>
            {" · "}
            <a
              href="https://supabase.com/docs/reference/javascript/auth-signinwithotp"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              signInWithOtp
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
