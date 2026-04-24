import { z } from "zod";

export const SKILLS_ROOT_PATH = "/skills";
export const SKILL_ENTRY_FILE = "SKILL.md";
export const MAX_SELECTED_SKILLS = 5;
export const SKILL_LIST_CACHE_TTL_MS = 60_000;
export const SKILL_CONTENT_CACHE_TTL_MS = 60_000;

const SKILL_ID_PATTERN = /^[a-z0-9_-]+$/;

type FrontmatterValue =
  | string
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export const skillRuntimeSchema = z.enum([
  "prompt-only",
  "nodejs-edge-sandbox",
]);

export const skillIdSchema = z
  .string()
  .trim()
  .min(1, "skill id is required")
  .max(64, "skill id is too long")
  .regex(
    SKILL_ID_PATTERN,
    "skill id may only contain lowercase letters, numbers, hyphen, and underscore",
  );

export const skillSelectionSchema = z
  .array(skillIdSchema)
  .max(MAX_SELECTED_SKILLS, `最多选择 ${MAX_SELECTED_SKILLS} 个 skill`)
  .transform((ids) => uniqueSkillIds(ids));

const skillFrontmatterSchema = z.object({
  name: skillIdSchema.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(400).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  enabled: z.boolean().optional(),
  runtime: skillRuntimeSchema.optional(),
  entry: z.string().trim().min(1).max(256).optional(),
  permissions: z
    .object({
      network: z.boolean().optional(),
      fs: z.boolean().optional(),
    })
    .optional(),
});

export type SkillRuntime = z.infer<typeof skillRuntimeSchema>;

export interface SkillDefinition {
  id: string;
  title: string;
  description: string;
  tags: string[];
  enabled: boolean;
  runtime: SkillRuntime;
  updatedAt?: string;
  instructions: string;
  source: string;
  entry?: string;
  permissions?: {
    network?: boolean;
    fs?: boolean;
  };
}

export interface SkillDocumentView {
  id: string;
  title: string;
  updatedAt?: string;
  content: string;
}

export interface SkillSummary {
  id: string;
  title: string;
  description: string;
  tags: string[];
  runtime: SkillRuntime;
  updatedAt?: string;
  entry?: string;
  permissions?: {
    network?: boolean;
    fs?: boolean;
  };
}

interface ParsedDocumentFallback {
  title?: string;
  description?: string;
}

export class SkillDocumentError extends Error {
  readonly name = "SkillDocumentError";
}

export function uniqueSkillIds(skillIds: string[]): string[] {
  return [...new Set(skillIds)];
}

export function buildSkillSummary(skill: SkillDefinition): SkillSummary {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    tags: skill.tags,
    runtime: skill.runtime,
    updatedAt: skill.updatedAt,
    entry: skill.entry,
    permissions: skill.permissions,
  };
}

export function buildSkillDocumentView(
  skill: SkillDefinition,
): SkillDocumentView {
  return {
    id: skill.id,
    title: skill.title,
    updatedAt: skill.updatedAt,
    content: skill.source,
  };
}

export function buildSkillsMetadataPrompt(skills: SkillSummary[]): string {
  if (skills.length === 0) {
    return "";
  }

  const sections = skills.map((skill) => {
    const lines = [
      `## Skill: ${skill.title}`,
      `ID: ${skill.id}`,
      `Description: ${skill.description}`,
      `Runtime: ${skill.runtime}`,
    ];

    if (skill.tags.length > 0) {
      lines.push(`Tags: ${skill.tags.join(", ")}`);
    }

    if (skill.updatedAt) {
      lines.push(`Updated At: ${skill.updatedAt}`);
    }

    if (skill.entry) {
      lines.push(`Declared entry: ${skill.entry}`);
    }

    if (skill.permissions) {
      lines.push(
        `Declared permissions: network=${String(skill.permissions.network ?? false)}, fs=${String(skill.permissions.fs ?? false)}`,
      );
    }

    lines.push(
      "Metadata only. Skill instructions are not preloaded into context unless a later mechanism explicitly expands them.",
    );

    return lines.join("\n");
  });

  return ["[Available Skills Metadata]", ...sections].join("\n\n");
}

export function splitSkillFrontmatter(source: string): {
  frontmatter: string | null;
  body: string;
} {
  const normalized = normalizeSkillSource(source);
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return {
      frontmatter: null,
      body: normalized.trim(),
    };
  }
  const frontmatter = match[1]?.trim() || "";
  const body = normalized.slice(match[0].length).trim();
  return { frontmatter, body };
}

export function parseSkillDocument(
  skillId: string,
  source: string,
  updatedAt?: string,
): SkillDefinition {
  const normalizedSource = normalizeSkillSource(source);
  const { frontmatter, body } = splitSkillFrontmatter(source);
  const fallback = extractDocumentFallback(body);

  let metadata: z.infer<typeof skillFrontmatterSchema> = {};
  if (frontmatter) {
    const parsedFrontmatter = parseFrontmatterBlock(frontmatter);
    const result = skillFrontmatterSchema.safeParse(parsedFrontmatter);
    if (!result.success) {
      throw new SkillDocumentError(
        result.error.issues[0]?.message || "Invalid skill frontmatter",
      );
    }
    metadata = result.data;

    if (metadata.name && metadata.name !== skillId) {
      throw new SkillDocumentError(
        `Skill frontmatter name "${metadata.name}" does not match directory id "${skillId}"`,
      );
    }
  }

  if (!body) {
    throw new SkillDocumentError(`Skill "${skillId}" is missing instructions`);
  }

  const title = metadata.title || fallback.title || formatSkillTitle(skillId);
  const description =
    metadata.description ||
    fallback.description ||
    `${title} skill instructions`;

  return {
    id: skillId,
    title,
    description,
    tags: metadata.tags ?? [],
    enabled: metadata.enabled ?? true,
    runtime: metadata.runtime ?? "prompt-only",
    updatedAt,
    instructions: body,
    source: normalizedSource,
    entry: metadata.entry,
    permissions: metadata.permissions,
  };
}

export function buildSkillsPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) {
    return "";
  }

  const sections = skills.map((skill) => {
    const lines = [
      `## Skill: ${skill.title}`,
      `ID: ${skill.id}`,
      `Description: ${skill.description}`,
      `Runtime: ${skill.runtime}`,
    ];

    if (skill.runtime === "nodejs-edge-sandbox") {
      lines.push(
        "Runtime status: metadata only. Script execution is not enabled yet, so do not assume any skill script has run.",
      );
      if (skill.entry) {
        lines.push(`Declared entry: ${skill.entry}`);
      }
      if (skill.permissions) {
        lines.push(
          `Declared permissions: network=${String(skill.permissions.network ?? false)}, fs=${String(skill.permissions.fs ?? false)}`,
        );
      }
    }

    lines.push("Instructions:");
    lines.push(skill.instructions.trim());

    return lines.join("\n");
  });

  return ["[Enabled Skills]", ...sections].join("\n\n");
}

function extractDocumentFallback(body: string): ParsedDocumentFallback {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const title = lines
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  const description = lines.find(
    (line) =>
      !line.startsWith("#") &&
      !line.startsWith(">") &&
      !line.startsWith("- ") &&
      !line.startsWith("* "),
  );

  return {
    title: title || undefined,
    description: description || undefined,
  };
}

function formatSkillTitle(skillId: string): string {
  return skillId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeSkillSource(source: string): string {
  return source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function parseFrontmatterBlock(
  source: string,
): Record<string, FrontmatterValue> {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const { value } = parseObjectBlock(lines, 0, 0);

  if (!isPlainObject(value)) {
    throw new SkillDocumentError("Skill frontmatter must be a YAML object");
  }

  return value;
}

function parseObjectBlock(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: Record<string, FrontmatterValue>; nextIndex: number } {
  const result: Record<string, FrontmatterValue> = {};
  let index = startIndex;

  while (index < lines.length) {
    index = skipIgnorableLines(lines, index);
    if (index >= lines.length) {
      break;
    }

    const line = lines[index];
    const lineIndent = getIndent(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent > indent) {
      throw new SkillDocumentError(
        `Unexpected indentation in frontmatter on line ${index + 1}`,
      );
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      throw new SkillDocumentError(
        `Unexpected array item in frontmatter on line ${index + 1}`,
      );
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      throw new SkillDocumentError(
        `Invalid frontmatter entry on line ${index + 1}`,
      );
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      throw new SkillDocumentError(
        `Missing frontmatter key on line ${index + 1}`,
      );
    }

    if (rawValue) {
      result[key] = parseScalarValue(rawValue);
      index += 1;
      continue;
    }

    const nestedIndex = skipIgnorableLines(lines, index + 1);
    if (nestedIndex >= lines.length) {
      result[key] = "";
      index = nestedIndex;
      continue;
    }

    const nestedIndent = getIndent(lines[nestedIndex]);
    if (nestedIndent <= lineIndent) {
      result[key] = "";
      index = nestedIndex;
      continue;
    }

    const parsedNested = parseNestedBlock(lines, nestedIndex, nestedIndent);
    result[key] = parsedNested.value;
    index = parsedNested.nextIndex;
  }

  return { value: result, nextIndex: index };
}

function parseArrayBlock(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: FrontmatterValue[]; nextIndex: number } {
  const result: FrontmatterValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    index = skipIgnorableLines(lines, index);
    if (index >= lines.length) {
      break;
    }

    const line = lines[index];
    const lineIndent = getIndent(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent !== indent) {
      throw new SkillDocumentError(
        `Unexpected indentation in frontmatter array on line ${index + 1}`,
      );
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      break;
    }

    const rawValue = trimmed.slice(2).trim();
    if (rawValue) {
      result.push(parseScalarValue(rawValue));
      index += 1;
      continue;
    }

    const nestedIndex = skipIgnorableLines(lines, index + 1);
    if (nestedIndex >= lines.length) {
      result.push("");
      index = nestedIndex;
      continue;
    }

    const nestedIndent = getIndent(lines[nestedIndex]);
    if (nestedIndent <= lineIndent) {
      result.push("");
      index = nestedIndex;
      continue;
    }

    const parsedNested = parseNestedBlock(lines, nestedIndex, nestedIndent);
    result.push(parsedNested.value);
    index = parsedNested.nextIndex;
  }

  return { value: result, nextIndex: index };
}

function parseNestedBlock(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: FrontmatterValue; nextIndex: number } {
  const trimmed = lines[startIndex]?.trim() || "";
  if (trimmed.startsWith("- ")) {
    return parseArrayBlock(lines, startIndex, indent);
  }
  return parseObjectBlock(lines, startIndex, indent);
}

function parseScalarValue(rawValue: string): FrontmatterValue {
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (rawValue === "null") {
    return null;
  }
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    const inner = rawValue.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitInlineArray(inner).map((value) => parseScalarValue(value));
  }
  return rawValue;
}

function splitInlineArray(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

function skipIgnorableLines(lines: string[], startIndex: number): number {
  let index = startIndex;
  while (index < lines.length) {
    const trimmed = lines[index]?.trim() || "";
    if (!trimmed || trimmed.startsWith("#")) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function getIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function isPlainObject(
  value: FrontmatterValue,
): value is Record<string, FrontmatterValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
