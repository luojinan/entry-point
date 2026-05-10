import { ArrowLeft02Icon, File01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SKILL_ENTRY_FILE,
  type SkillDocumentView,
  type SkillSummary,
} from "@/lib/skills";
import { cn } from "@/lib/utils";

interface ChatSkillsViewerProps {
  disabled?: boolean;
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

async function loadSkillOptions(signal?: AbortSignal): Promise<SkillSummary[]> {
  const response = await fetch("/api/skills", { signal });
  const payload = (await response.json()) as ApiEnvelope<SkillSummary[]>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "加载 skills 失败");
  }

  return payload.data;
}

async function loadSkillDocument(skillId: string): Promise<SkillDocumentView> {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`);
  const payload = (await response.json()) as ApiEnvelope<SkillDocumentView>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "加载 skill 内容失败");
  }

  return payload.data;
}

function formatUpdatedAt(updatedAt?: string): string | null {
  if (!updatedAt) {
    return null;
  }

  const value = new Date(updatedAt);
  if (Number.isNaN(value.getTime())) {
    return updatedAt;
  }

  return dateFormatter.format(value);
}

export function ChatSkillsViewer({ disabled = false }: ChatSkillsViewerProps) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "detail">("list");
  const [documents, setDocuments] = useState<Record<string, SkillDocumentView>>(
    {},
  );
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (skills.length === 0) {
      setSelectedSkillId(null);
      return;
    }

    setSelectedSkillId((current) => {
      if (current && skills.some((skill) => skill.id === current)) {
        return current;
      }
      return skills[0]?.id ?? null;
    });
  }, [skills]);

  useEffect(() => {
    if (!open) {
      setView("list");
      setDocumentError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || hasLoaded) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setIsLoading(true);
    setError(null);

    void loadSkillOptions(controller.signal)
      .then((loadedSkills) => {
        if (cancelled) {
          return;
        }

        setSkills(loadedSkills);
        setHasLoaded(true);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setSkills([]);
        setError(
          loadError instanceof Error ? loadError.message : "加载 skills 失败",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hasLoaded, open]);

  useEffect(() => {
    if (
      !open ||
      view !== "detail" ||
      !selectedSkillId ||
      documents[selectedSkillId]
    ) {
      return;
    }

    let cancelled = false;
    const currentSkillId = selectedSkillId;

    setLoadingDocumentId(currentSkillId);
    setDocumentError(null);

    void loadSkillDocument(currentSkillId)
      .then((document) => {
        if (cancelled) {
          return;
        }

        setDocuments((current) => ({
          ...current,
          [document.id]: document,
        }));
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setDocumentError(
          loadError instanceof Error
            ? loadError.message
            : "加载 skill 内容失败",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDocumentId((current) =>
            current === currentSkillId ? null : current,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documents, open, selectedSkillId, view]);

  const selectedSkill = useMemo(
    () =>
      skills.find((skill) => skill.id === selectedSkillId) ?? skills[0] ?? null,
    [selectedSkillId, skills],
  );
  const selectedDocument = selectedSkillId ? documents[selectedSkillId] : null;

  const helperText = error
    ? error
    : isLoading
      ? "正在加载 Skills 元数据"
      : hasLoaded
        ? skills.length > 0
          ? `已加载 ${skills.length} 个 Skills 元数据`
          : "暂无可用 Skills"
        : "点击后加载 Skills 元数据";

  return (
    <div className="min-w-0">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={<Button variant="outline" size="icon-sm" />}
          disabled={disabled || (isLoading && skills.length === 0)}
          aria-label="查看 Skills"
          title={`查看 Skills${helperText ? `：${helperText}` : ""}`}
        >
          <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
        </AlertDialogTrigger>

        <AlertDialogContent
          className="h-[min(88vh,42rem)] w-[min(96vw,56rem)] max-w-[56rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
          size="default"
        >
          <div className="border-b px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <AlertDialogTitle className="text-base">
                  Skills 查看器
                </AlertDialogTitle>
                <AlertDialogDescription className="text-left text-sm">
                  打开弹窗时才会拉取 Skills 元数据，这里只负责查看。
                </AlertDialogDescription>
              </div>
              <Badge variant="outline" className="shrink-0">
                {skills.length} items
              </Badge>
            </div>
          </div>

          {skills.length === 0 ? (
            <div className="text-muted-foreground flex min-h-0 items-center justify-center px-6 text-center text-sm">
              {helperText}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {view === "list" ? (
                <>
                  <div className="text-muted-foreground border-b px-4 py-3 text-xs">
                    {helperText}
                  </div>
                  <div className="min-h-0 overflow-y-auto p-2">
                    {skills.map((skill) => {
                      const selected = skill.id === selectedSkill?.id;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          className={cn(
                            "w-full rounded-xl border p-3 text-left transition-colors",
                            selected
                              ? "border-primary/30 bg-primary/5 shadow-sm"
                              : "border-border/70 bg-background hover:bg-muted/40",
                          )}
                          onClick={() => {
                            setSelectedSkillId(skill.id);
                            setView("detail");
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {skill.title}
                              </div>
                              <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                                {skill.description}
                              </div>
                            </div>
                            <Badge variant="outline" className="shrink-0">
                              {skill.runtime === "prompt-only"
                                ? "Prompt"
                                : "Edge"}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : selectedSkill ? (
                <>
                  <div className="border-b px-3 py-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setView("list");
                      }}
                    >
                      <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} />
                      返回列表
                    </Button>
                  </div>
                  <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
                    <SkillDetail
                      skill={selectedSkill}
                      document={selectedDocument}
                      isLoading={loadingDocumentId === selectedSkill.id}
                      error={documentError}
                    />
                  </div>
                </>
              ) : null}
            </div>
          )}

          <div className="bg-muted/25 border-t px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-muted-foreground text-xs leading-5">
                Skills 元数据已默认可见，不再按会话单独选择注入。
              </div>
              <AlertDialogCancel size="sm">关闭</AlertDialogCancel>
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SkillDetail({
  skill,
  document,
  isLoading,
  error,
}: {
  skill: SkillSummary;
  document: SkillDocumentView | null;
  isLoading: boolean;
  error: string | null;
}) {
  const updatedAtLabel = formatUpdatedAt(
    document?.updatedAt ?? skill.updatedAt,
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">
          {skill.id}/{SKILL_ENTRY_FILE}
        </div>
        {updatedAtLabel ? (
          <div className="text-muted-foreground text-xs">
            更新时间 {updatedAtLabel}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground rounded-xl border p-4 text-sm">
          正在加载原始内容...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <pre className="min-h-0 overflow-x-auto text-sm leading-6 whitespace-pre-wrap break-words">
          {document?.content || "暂无内容"}
        </pre>
      )}
    </div>
  );
}
