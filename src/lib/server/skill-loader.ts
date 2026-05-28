import { posix as pathPosix } from "node:path";

import type { RuntimeEnv } from "@/lib/runtime-env";
import {
  isRemoteFileError,
  listRemoteFiles,
  readRemoteText,
} from "@/lib/server/remote-files";
import {
  buildSkillSummary,
  parseSkillDocument,
  SKILL_CONTENT_CACHE_TTL_MS,
  SKILL_ENTRY_FILE,
  SKILL_LIST_CACHE_TTL_MS,
  SKILLS_ROOT_PATH,
  type SkillDefinition,
  SkillDocumentError,
  type SkillSummary,
  skillIdSchema,
} from "@/lib/skills";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export interface SafeSkillsResult {
  skills: SkillSummary[];
  error: string | null;
}

interface SkillLoadOptions {
  preferFresh?: boolean;
  allowStaleOnError?: boolean;
}

const skillSummaryCache: { current: CacheEntry<SkillSummary[]> | null } = {
  current: null,
};
const skillContentCache = new Map<string, CacheEntry<SkillDefinition | null>>();

export async function listSkills(
  env?: RuntimeEnv,
  options: SkillLoadOptions = {},
): Promise<SkillSummary[]> {
  const now = Date.now();
  const cached = skillSummaryCache.current;
  if (!options.preferFresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  let directoryEntries: Awaited<ReturnType<typeof listRemoteFiles>>["entries"];
  try {
    const result = await listRemoteFiles(SKILLS_ROOT_PATH, env);
    directoryEntries = result.entries;
  } catch (error) {
    if (options.allowStaleOnError && cached) {
      return cached.value;
    }

    if (isMissingPath(error)) {
      skillSummaryCache.current = {
        value: [],
        expiresAt: now + SKILL_LIST_CACHE_TTL_MS,
      };
      return [];
    }
    throw error;
  }

  const skillIds = directoryEntries
    .filter((entry) => entry.isDir)
    .map((entry) => entry.name)
    .filter((name): name is string => skillIdSchema.safeParse(name).success);

  const summaries = (
    await Promise.all(
      skillIds.map(async (skillId) => {
        try {
          const skill = await getSkillById(skillId, env, options);
          if (!skill?.enabled) {
            return null;
          }
          return buildSkillSummary(skill);
        } catch (error) {
          if (error instanceof SkillDocumentError) {
            console.warn(`Skipping invalid skill "${skillId}":`, error.message);
            return null;
          }
          throw error;
        }
      }),
    )
  )
    .filter((skill): skill is SkillSummary => Boolean(skill))
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));

  skillSummaryCache.current = {
    value: summaries,
    expiresAt: now + SKILL_LIST_CACHE_TTL_MS,
  };

  return summaries;
}

export async function listSkillsSafely(
  env?: RuntimeEnv,
  options: SkillLoadOptions = {},
): Promise<SafeSkillsResult> {
  try {
    return {
      skills: await listSkills(env, options),
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load skills";
    console.warn("Failed to load skills, continuing without skills:", error);
    return {
      skills: [],
      error: message,
    };
  }
}

export async function getSkillsByIds(
  skillIds: string[],
  env?: RuntimeEnv,
  options: SkillLoadOptions = {},
): Promise<SkillDefinition[]> {
  const skills = await Promise.all(
    skillIds.map(async (skillId) => {
      try {
        return await getSkillById(skillId, env, options);
      } catch (error) {
        if (error instanceof SkillDocumentError) {
          console.warn(
            `Skipping invalid selected skill "${skillId}":`,
            error.message,
          );
          return null;
        }
        throw error;
      }
    }),
  );

  return skills.filter((skill): skill is SkillDefinition =>
    Boolean(skill?.enabled),
  );
}

export async function getSkillById(
  skillId: string,
  env?: RuntimeEnv,
  options: SkillLoadOptions = {},
): Promise<SkillDefinition | null> {
  const parsedId = skillIdSchema.safeParse(skillId);
  if (!parsedId.success) {
    return null;
  }

  const now = Date.now();
  const cached = skillContentCache.get(parsedId.data);
  if (!options.preferFresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const skillPath = buildSkillPath(parsedId.data);

  try {
    const result = await readRemoteText(skillPath, env);
    const skill = parseSkillDocument(
      parsedId.data,
      result.content,
      result.updatedAt,
    );
    skillContentCache.set(parsedId.data, {
      value: skill,
      expiresAt: now + SKILL_CONTENT_CACHE_TTL_MS,
    });
    return skill;
  } catch (error) {
    if (options.allowStaleOnError && cached) {
      return cached.value;
    }

    if (isMissingPath(error)) {
      skillContentCache.set(parsedId.data, {
        value: null,
        expiresAt: now + SKILL_CONTENT_CACHE_TTL_MS,
      });
      return null;
    }

    if (error instanceof Error) {
      console.warn(`Failed to load skill "${parsedId.data}":`, error.message);
    }
    throw error;
  }
}

function buildSkillPath(skillId: string): string {
  return pathPosix.join(SKILLS_ROOT_PATH, skillId, SKILL_ENTRY_FILE);
}

function isMissingPath(error: unknown): boolean {
  return isRemoteFileError(error) && error.code === "NOT_FOUND";
}
