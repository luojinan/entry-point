import type { SkillDocumentView, SkillSummary } from "@/lib/skills";

const SKILLS_VIEWER_CACHE_KEY = "chat-skills-viewer-cache-v2";

export interface SkillsViewerCache {
  skills: SkillSummary[] | null;
  skillsCachedAt?: string;
  documents: Record<string, SkillDocumentView>;
  documentCachedAt: Record<string, string>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSkillRuntime(value: unknown): value is SkillSummary["runtime"] {
  return value === "prompt-only" || value === "nodejs-edge-sandbox";
}

function isPermissions(
  value: unknown,
): value is NonNullable<SkillSummary["permissions"]> {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    (typeof value.network === "boolean" || value.network === undefined) &&
    (typeof value.fs === "boolean" || value.fs === undefined)
  );
}

function isSkillSummary(value: unknown): value is SkillSummary {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    isSkillRuntime(value.runtime) &&
    (typeof value.updatedAt === "string" || value.updatedAt === undefined) &&
    (typeof value.entry === "string" || value.entry === undefined) &&
    (value.permissions === undefined || isPermissions(value.permissions))
  );
}

function isSkillDocumentView(value: unknown): value is SkillDocumentView {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (typeof value.updatedAt === "string" || value.updatedAt === undefined) &&
    typeof value.content === "string"
  );
}

export function readSkillsViewerCache(): SkillsViewerCache {
  if (typeof window === "undefined") {
    return {
      skills: null,
      documents: {},
      documentCachedAt: {},
    };
  }

  const cachedValue = window.localStorage.getItem(SKILLS_VIEWER_CACHE_KEY);
  if (!cachedValue) {
    return {
      skills: null,
      documents: {},
      documentCachedAt: {},
    };
  }

  try {
    const parsedValue: unknown = JSON.parse(cachedValue);
    if (!isObjectRecord(parsedValue)) {
      return {
        skills: null,
        documents: {},
        documentCachedAt: {},
      };
    }

    const skills =
      parsedValue.skills === null
        ? null
        : Array.isArray(parsedValue.skills) &&
            parsedValue.skills.every((item) => isSkillSummary(item))
          ? parsedValue.skills
          : null;

    const documents = isObjectRecord(parsedValue.documents)
      ? Object.fromEntries(
          Object.entries(parsedValue.documents).filter(([, value]) =>
            isSkillDocumentView(value),
          ),
        )
      : {};
    const documentCachedAt = isObjectRecord(parsedValue.documentCachedAt)
      ? Object.fromEntries(
          Object.entries(parsedValue.documentCachedAt).filter(
            ([skillId, value]) =>
              typeof skillId === "string" && typeof value === "string",
          ),
        )
      : {};

    return {
      skills,
      skillsCachedAt:
        typeof parsedValue.skillsCachedAt === "string"
          ? parsedValue.skillsCachedAt
          : undefined,
      documents,
      documentCachedAt,
    };
  } catch {
    return {
      skills: null,
      documents: {},
      documentCachedAt: {},
    };
  }
}

export function writeSkillsViewerCache(cache: SkillsViewerCache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SKILLS_VIEWER_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full or unavailable
  }
}
