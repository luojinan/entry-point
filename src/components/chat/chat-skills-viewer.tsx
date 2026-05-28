import {
  ArrowLeft02Icon,
  File01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

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
  MAX_SELECTED_SKILLS,
  SKILL_ENTRY_FILE,
  type SkillDocumentView,
  type SkillSummary,
} from "@/lib/skills";
import {
  readSkillsViewerCache,
  type SkillsViewerCache,
  writeSkillsViewerCache,
} from "@/lib/skills-viewer-cache";
import { cn } from "@/lib/utils";

interface ChatSkillsViewerProps {
  disabled?: boolean;
  selectedSkillIds?: string[];
  onSelectedSkillIdsChange?: (skillIds: string[]) => void;
}

interface SkillsLoadResult {
  skills: SkillSummary[];
  error: string | null;
}

const SKILLS_QUERY_KEY = ["skills", "viewer", "list"] as const;
const EMPTY_DOCUMENT_QUERY_KEY = [
  "skills",
  "viewer",
  "document",
  "empty",
] as const;

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function getSkillDocumentQueryKey(skillId: string) {
  return ["skills", "viewer", "document", skillId] as const;
}

async function loadSkillOptions(
  signal?: AbortSignal,
): Promise<SkillsLoadResult> {
  const response = await fetch("/api/skills", { signal });
  const payload = (await response.json()) as {
    code: number;
    message: string;
    data?: SkillsLoadResult;
  };
  if (!response.ok || payload.code !== 0 || !payload.data) {
    throw new Error(payload.message || "Failed to load skills");
  }
  return payload.data;
}

async function loadSkillDocument(
  skillId: string,
  signal?: AbortSignal,
): Promise<SkillDocumentView> {
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
    signal,
  });
  const payload = (await response.json()) as {
    code: number;
    message: string;
    data?: SkillDocumentView;
  };
  if (!response.ok || payload.code !== 0 || !payload.data) {
    throw new Error(payload.message || "Skill not found");
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

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  return null;
}

function updateBrowserCache(
  setBrowserCache: Dispatch<SetStateAction<SkillsViewerCache>>,
  updater: (current: SkillsViewerCache) => SkillsViewerCache,
) {
  setBrowserCache((current) => {
    const next = updater(current);
    if (next === current) {
      return current;
    }
    writeSkillsViewerCache(next);
    return next;
  });
}

export function ChatSkillsViewer({
  disabled = false,
  selectedSkillIds = [],
  onSelectedSkillIdsChange,
}: ChatSkillsViewerProps) {
  const [open, setOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "detail">("list");
  const [browserCache, setBrowserCache] = useState<SkillsViewerCache>(() =>
    readSkillsViewerCache(),
  );

  const hasCachedSkills = browserCache.skills !== null;
  const cachedSkills = browserCache.skills ?? [];
  const cachedSelectedDocument = selectedSkillId
    ? (browserCache.documents[selectedSkillId] ?? null)
    : null;

  const {
    data: skillsData,
    error: skillsError,
    isFetching: isFetchingSkills,
    refetch: refetchSkills,
  } = useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: ({ signal }) => loadSkillOptions(signal),
    enabled: open && !hasCachedSkills,
    initialData: browserCache.skills
      ? { skills: browserCache.skills, error: null }
      : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const skills = skillsData?.skills ?? cachedSkills;
  const selectedSkillIdSet = useMemo(
    () => new Set(selectedSkillIds),
    [selectedSkillIds],
  );

  const {
    data: selectedDocumentData,
    error: selectedDocumentQueryError,
    isFetching: isFetchingDocument,
    refetch: refetchSelectedDocument,
  } = useQuery({
    queryKey: selectedSkillId
      ? getSkillDocumentQueryKey(selectedSkillId)
      : EMPTY_DOCUMENT_QUERY_KEY,
    queryFn: ({ signal }) => loadSkillDocument(selectedSkillId!, signal),
    enabled: false,
    initialData: cachedSelectedDocument ?? undefined,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (skillsData === undefined) {
      return;
    }

    updateBrowserCache(setBrowserCache, (current) => {
      if (current.skills === skillsData.skills) {
        return current;
      }

      return {
        ...current,
        skills: skillsData.skills,
      };
    });
  }, [skillsData]);

  useEffect(() => {
    if (!selectedDocumentData) {
      return;
    }

    updateBrowserCache(setBrowserCache, (current) => {
      const currentDocument = current.documents[selectedDocumentData.id];
      if (
        currentDocument?.title === selectedDocumentData.title &&
        currentDocument?.updatedAt === selectedDocumentData.updatedAt &&
        currentDocument?.content === selectedDocumentData.content
      ) {
        return current;
      }

      return {
        ...current,
        documents: {
          ...current.documents,
          [selectedDocumentData.id]: selectedDocumentData,
        },
      };
    });
  }, [selectedDocumentData]);

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
    }
  }, [open]);

  const selectedSkill = useMemo(
    () =>
      skills.find((skill) => skill.id === selectedSkillId) ?? skills[0] ?? null,
    [selectedSkillId, skills],
  );
  const selectedDocument =
    selectedDocumentData ?? cachedSelectedDocument ?? null;

  const skillsLoadErrorMessage = skillsData?.error ?? null;
  const skillsErrorMessage =
    skillsLoadErrorMessage ?? getErrorMessage(skillsError);
  const documentErrorMessage = selectedDocument
    ? null
    : getErrorMessage(selectedDocumentQueryError);
  const isRefreshing = isFetchingSkills || isFetchingDocument;

  const helperText = skillsErrorMessage
    ? skillsErrorMessage
    : isFetchingSkills
      ? hasCachedSkills
        ? "正在刷新 Skills 元数据"
        : "正在加载 Skills 元数据"
      : hasCachedSkills
        ? skills.length > 0
          ? `已缓存 ${skills.length} 个 Skills 元数据`
          : "暂无可用 Skills"
        : "首次打开后会自动加载 Skills 元数据";

  async function handleRefresh() {
    await refetchSkills();

    if (view === "detail" && selectedSkillId) {
      await refetchSelectedDocument();
    }
  }

  function toggleSkillSelection(skillId: string) {
    if (!onSelectedSkillIdsChange) {
      return;
    }

    if (selectedSkillIdSet.has(skillId)) {
      onSelectedSkillIdsChange(selectedSkillIds.filter((id) => id !== skillId));
      return;
    }

    if (selectedSkillIds.length >= MAX_SELECTED_SKILLS) {
      return;
    }

    onSelectedSkillIdsChange([...selectedSkillIds, skillId]);
  }

  return (
    <div className="min-w-0">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <div className="relative inline-flex">
          <AlertDialogTrigger
            render={<Button variant="outline" size="icon-sm" />}
            disabled={disabled}
            aria-label="查看 Skills"
            title={`查看 Skills${helperText ? `：${helperText}` : ""}`}
          >
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
          </AlertDialogTrigger>
          {skillsLoadErrorMessage ? (
            <span
              aria-hidden="true"
              className="border-background bg-destructive absolute -top-1 -right-1 size-2.5 rounded-full border"
            />
          ) : null}
        </div>

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
                  首次无缓存时会自动加载一次，后续请手动刷新。
                </AlertDialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">
                  {selectedSkillIds.length}/{MAX_SELECTED_SKILLS}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isRefreshing}
                  onClick={() => {
                    void handleRefresh();
                  }}
                >
                  <HugeiconsIcon
                    icon={Refresh01Icon}
                    strokeWidth={2}
                    className={cn(isRefreshing && "animate-spin")}
                  />
                  {isRefreshing ? "刷新中..." : "刷新"}
                </Button>
              </div>
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
                      const enabled = selectedSkillIdSet.has(skill.id);
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
                            <div className="flex shrink-0 items-center gap-2">
                              <Button
                                type="button"
                                variant={enabled ? "default" : "outline"}
                                size="xs"
                                disabled={
                                  !enabled &&
                                  selectedSkillIds.length >= MAX_SELECTED_SKILLS
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSkillSelection(skill.id);
                                }}
                              >
                                {enabled ? "已启用" : "启用"}
                              </Button>
                              <Badge variant="outline">
                                {skill.runtime === "prompt-only"
                                  ? "Prompt"
                                  : "Edge"}
                              </Badge>
                            </div>
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
                      isLoading={
                        open &&
                        view === "detail" &&
                        !!selectedSkillId &&
                        !selectedDocument &&
                        isFetchingDocument
                      }
                      error={documentErrorMessage}
                    />
                  </div>
                </>
              ) : null}
            </div>
          )}

          <div className="bg-muted/25 border-t px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-muted-foreground text-xs leading-5">
                已启用的 Skills 会在发送消息时按需加载进上下文。
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
