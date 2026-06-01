import { createMCPClient } from "@ai-sdk/mcp";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  hasToolCall,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
} from "ai";
import { z } from "zod";

import { getModel } from "@/lib/ai-provider";
import {
  errorResponse,
  handleCorsPreflightRequest,
  withCors,
} from "@/lib/api-utils";
import {
  type ChatImageAttachment,
  type ChatMessage,
  isImageAttachmentPart,
} from "@/lib/chat-message";
import {
  remoteFileDeleteSchema,
  remoteFileMkdirSchema,
  remoteFileMoveSchema,
  remoteFileQueryPathSchema,
  remoteFileWriteSchema,
} from "@/lib/remote-files";
import { getRequestEnv, getRuntimeEnvValue } from "@/lib/runtime-env";
import { signChatObjectUrl } from "@/lib/server/chat-aliyun";
import { getChatModelConfig } from "@/lib/server/llm-config";
import {
  createRemoteDirectory,
  deleteRemotePath,
  listRemoteFiles,
  moveRemotePath,
  readRemoteText,
  statRemotePath,
  writeRemoteText,
} from "@/lib/server/remote-files";
import {
  getSkillById,
  getSkillsByIds,
  listSkillsSafely,
} from "@/lib/server/skill-loader";
import {
  buildSkillsMetadataPrompt,
  buildSkillsPrompt,
  SKILLS_ROOT_PATH,
  skillSelectionSchema,
} from "@/lib/skills";
import { search } from "@/lib/tg-search/search";

const SQL_WRITE_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "UPSERT",
  "MERGE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COMMENT",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "REFRESH",
  "CALL",
  "DO",
] as const;

const SQL_READONLY_FIRST_KEYWORDS = new Set([
  "SELECT",
  "WITH",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
  "VALUES",
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getMessageContentParts(message: unknown): unknown[] {
  if (!isObjectRecord(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content;
}

function extractToolApprovalReason(
  messages: unknown,
  toolCallId: string,
): unknown {
  if (!Array.isArray(messages)) {
    return null;
  }

  const approvalIds = new Set<string>();
  for (const message of messages) {
    for (const part of getMessageContentParts(message)) {
      if (!isObjectRecord(part) || part.type !== "tool-approval-request") {
        continue;
      }
      if (
        part.toolCallId === toolCallId &&
        typeof part.approvalId === "string"
      ) {
        approvalIds.add(part.approvalId);
      }
    }
  }

  if (approvalIds.size === 0) {
    return null;
  }

  for (const message of messages) {
    for (const part of getMessageContentParts(message)) {
      if (!isObjectRecord(part) || part.type !== "tool-approval-response") {
        continue;
      }
      if (
        typeof part.approvalId !== "string" ||
        !approvalIds.has(part.approvalId) ||
        typeof part.reason !== "string"
      ) {
        continue;
      }

      try {
        return JSON.parse(part.reason);
      } catch {
        return part.reason;
      }
    }
  }

  return null;
}

function getReadOnlyHint(annotations: unknown): boolean | undefined {
  if (!isObjectRecord(annotations)) {
    return undefined;
  }
  const hint = annotations.readOnlyHint;
  return typeof hint === "boolean" ? hint : undefined;
}

function extractSqlFromToolInput(input: unknown): string | null {
  if (!isObjectRecord(input)) {
    return null;
  }

  const candidates = [input.query, input.sql, input.statement];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return null;
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (!normalized) {
    return false;
  }

  const firstKeyword = normalized.match(/^[A-Z]+/)?.[0];
  if (!firstKeyword || !SQL_READONLY_FIRST_KEYWORDS.has(firstKeyword)) {
    return false;
  }

  const hasWriteKeyword = SQL_WRITE_KEYWORDS.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`).test(normalized),
  );

  return !hasWriteKeyword;
}

function shouldApproveSqlToolCall(input: unknown): boolean {
  const sql = extractSqlFromToolInput(input);
  if (sql == null) {
    return true;
  }
  return !isReadOnlySql(sql);
}

function attachmentToPromptText(attachment: ChatImageAttachment): string {
  const lines = [
    "[图片附件]",
    `文件名: ${attachment.fileName}`,
    `媒体类型: ${attachment.mimeType}`,
  ];

  if (attachment.ocr?.status === "ready") {
    lines.push("OCR 状态: 成功");
    lines.push(
      attachment.ocr.plainText
        ? `OCR 文本:\n${attachment.ocr.plainText}`
        : "OCR 文本为空，图片中可能没有可识别文本。",
    );
  } else if (attachment.ocr?.status === "error") {
    lines.push(`OCR 状态: 失败 (${attachment.ocr.error || "未知错误"})`);
  } else {
    lines.push("OCR 状态: 未完成");
  }

  lines.push("以上内容来自 OCR，可能存在识别误差。");
  return lines.join("\n");
}

function attachmentToImagePromptPart(
  attachment: ChatImageAttachment,
  env: ReturnType<typeof getRequestEnv>,
) {
  if (!attachment.bucket || !attachment.region || !attachment.objectKey) {
    return {
      type: "text" as const,
      text: attachmentToPromptText(attachment),
    };
  }

  const signedUrl = signChatObjectUrl(
    {
      bucket: attachment.bucket,
      region: attachment.region,
      objectKey: attachment.objectKey,
    },
    env,
  );

  return {
    type: "file" as const,
    data: new URL(signedUrl.url),
    filename: attachment.fileName,
    mediaType: attachment.mimeType,
  };
}

function withApproval<T extends ToolSet[keyof ToolSet]>(
  toolDefinition: T,
  needsApproval: boolean,
): T {
  toolDefinition.needsApproval = needsApproval;
  return toolDefinition;
}

function createToolSetWithout(
  tools: ToolSet,
  hiddenToolNames: string[],
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).filter(
      ([toolName]) => !hiddenToolNames.includes(toolName),
    ),
  ) as ToolSet;
}

const chatRequestSchema = z.object({
  messages: z.array(z.custom<ChatMessage>()),
  model: z.string().optional(),
  skillIds: skillSelectionSchema.optional(),
  thinkingEnabled: z.boolean().optional(),
});

const askUserQuestionSchema = z.object({
  title: z
    .string()
    .describe("这组问题的简短标题，例如“确认偏好”或“补充需求”。"),
  description: z
    .string()
    .optional()
    .describe("可选说明，帮助用户理解为什么需要确认这些问题。"),
  questions: z
    .array(
      z.object({
        id: z
          .string()
          .describe("问题的稳定 ID，使用小写字母、数字、短横线或下划线。"),
        question: z.string().describe("需要用户回答的问题。"),
        description: z.string().optional().describe("可选的问题补充说明。"),
        selectionMode: z
          .enum(["single", "multiple"])
          .default("single")
          .describe("single 表示单选，multiple 表示可多选。"),
        required: z
          .boolean()
          .default(true)
          .describe("是否必须选择至少一个选项后才能发送。"),
        options: z
          .array(
            z.object({
              id: z
                .string()
                .describe(
                  "选项的稳定 ID，使用小写字母、数字、短横线或下划线。",
                ),
              label: z.string().describe("展示给用户的选项文案。"),
              description: z
                .string()
                .optional()
                .describe("可选的选项补充说明。"),
              recommended: z
                .boolean()
                .default(false)
                .describe(
                  "该选项是否为 LLM 推荐选项。每个问题应至少标记一个推荐项；前端会在选项名旁展示“(推荐)”并默认勾选。",
                ),
            }),
          )
          .min(2)
          .describe("该问题可供勾选的选项，至少两个。"),
      }),
    )
    .min(1)
    .describe("需要用户确认的问题列表。"),
});

const BASE_SYSTEM_PROMPT =
  "你是一个有用的 AI 助手。当你需要向用户一次性确认多个有明确选项的问题时，优先使用 AskUserQuestion 工具，而不是在普通文本里列出多个问题让用户手动回复。当用户需要搜索影视、动漫、小说等资源时，请使用 searchTG 工具搜索 Telegram 频道。搜索结果会按网盘类型（quark/aliyun/baidu 等）分组返回，请以清晰易读的格式展示给用户，优先展示夸克网盘链接。工具路由规则如下：结构化业务数据默认使用 Supabase；查询记录、购汇记录、订单、配置、状态、报表、名单、统计等读取场景优先使用 querySupabaseData，行级新增/修改/删除优先使用 changeSupabaseData，只有数据库结构变更才使用 migrateSupabaseSchema。文件、目录、路径、文档内容等文件系统场景使用 Supabase 远程文件系统工具；除非用户明确要看文件，或数据库里没有所需信息需要补充读取文件，否则不要先查远程文件系统。远程文件系统对应的是共享的远端文件系统，不是本地磁盘。处理远程文件系统中的文件时，优先先用 statRemotePath 或 listRemoteFiles 确认路径和类型，再决定是否 read/write/move/delete；除非用户明确要求，否则不要覆盖已有文件、不要删除内容、不要扫描过大的目录。当工具执行审批被拒绝时，这表示用户明确拒绝了本次工具调用，不是工具报错，也不是工具不可用。遇到这种情况时，不要把它描述成调用失败，不要在同一轮再次尝试同一个工具，除非用户后续明确改变决定；你应该改为说明用户未授权该操作，并在现有信息范围内继续回答。多步工具任务完成并已准备好给用户最终答复时，调用 finalAnswer 工具结束工具循环。";

function buildCurrentTimePrompt(now = new Date()) {
  const beijingTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "long",
    hour12: false,
  }).format(now);

  return `当前时间：${beijingTime}（Asia/Shanghai）；UTC：${now.toISOString()}。`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request, context }) => {
        const parsedBody = chatRequestSchema.safeParse(await request.json());
        if (!parsedBody.success) {
          return errorResponse(
            parsedBody.error.issues[0]?.message || "Invalid chat request body",
            400,
          );
        }

        const {
          messages,
          model: modelId,
          skillIds = [],
          thinkingEnabled = false,
        } = parsedBody.data;
        const env = getRequestEnv(context);
        const modelConfig = await getChatModelConfig(env, modelId);
        const skillLoadOptions = {
          preferFresh: true,
          allowStaleOnError: true,
        };
        const [{ skills: availableSkills }, selectedSkills] = await Promise.all(
          [
            listSkillsSafely(env, skillLoadOptions),
            getSkillsByIds(skillIds, env, skillLoadOptions),
          ],
        );
        const systemPrompt = [
          BASE_SYSTEM_PROMPT,
          buildCurrentTimePrompt(),
          buildSkillsMetadataPrompt(availableSkills),
          buildSkillsPrompt(selectedSkills),
        ]
          .filter(Boolean)
          .join("\n\n");

        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null =
          null;
        let allTools: ToolSet = {};

        try {
          const projectRef = getRuntimeEnvValue(env, "SUPABASE_PROJECT_REF");
          const accessToken = getRuntimeEnvValue(env, "SUPABASE_ACCESS_TOKEN");

          if (!projectRef || !accessToken) {
            throw new Error(
              "Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN for Supabase MCP",
            );
          }

          mcpClient = await createMCPClient({
            transport: {
              type: "http",
              url: `https://mcp.supabase.com/mcp?project_ref=${projectRef}`,
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          });
          const definitions = await mcpClient.listTools();
          const mcpTools = mcpClient.toolsFromDefinitions(definitions);
          const definitionMap = new Map(
            definitions.tools.map((definition) => [
              definition.name,
              definition,
            ]),
          );

          for (const [toolName, mcpTool] of Object.entries(mcpTools)) {
            if (toolName === "execute_sql" || toolName === "apply_migration") {
              mcpTool.needsApproval = (input) =>
                shouldApproveSqlToolCall(input);
              continue;
            }

            const readOnlyHint = getReadOnlyHint(
              definitionMap.get(toolName)?.annotations,
            );
            mcpTool.needsApproval = readOnlyHint !== true;
          }
          allTools = createToolSetWithout(mcpTools as ToolSet, [
            "execute_sql",
            "apply_migration",
          ]);

          if (mcpTools.execute_sql) {
            allTools.querySupabaseData = withApproval(
              tool({
                description:
                  "查询 Supabase 中的结构化业务数据。用于记录、订单、配置、状态、报表、统计等数据库读取场景。",
                inputSchema: z.object({
                  query: z
                    .string()
                    .describe(
                      "只读 SQL，例如 SELECT、WITH、SHOW、EXPLAIN。用于查询结构化业务数据，不要写入或修改数据。",
                    ),
                }),
                execute: async ({ query }, options) => {
                  if (!isReadOnlySql(query)) {
                    throw new Error(
                      "querySupabaseData 仅支持只读 SQL。写入数据请使用 changeSupabaseData。",
                    );
                  }

                  return mcpTools.execute_sql.execute({ query }, options);
                },
              }),
              false,
            );

            allTools.changeSupabaseData = withApproval(
              tool({
                description:
                  "修改 Supabase 中的结构化业务数据。用于业务记录、配置、状态等行级数据的新增、更新、删除。",
                inputSchema: z.object({
                  query: z
                    .string()
                    .describe(
                      "写入 SQL，例如 INSERT、UPDATE、DELETE、UPSERT。仅用于行级数据变更，不用于 CREATE、ALTER、DROP 等结构变更。",
                    ),
                }),
                execute: async ({ query }, options) => {
                  if (isReadOnlySql(query)) {
                    throw new Error(
                      "changeSupabaseData 仅用于写入 SQL。只读查询请使用 querySupabaseData。",
                    );
                  }

                  return mcpTools.execute_sql.execute({ query }, options);
                },
              }),
              true,
            );
          }

          if (mcpTools.apply_migration) {
            allTools.migrateSupabaseSchema = withApproval(
              tool({
                description:
                  "变更 Supabase 数据库结构。仅用于表、索引、约束等 schema 迁移，不用于普通业务数据读写。",
                inputSchema: z.object({
                  name: z.string().describe("迁移名称，使用 snake_case。"),
                  query: z
                    .string()
                    .describe(
                      "DDL migration SQL，例如 CREATE TABLE、ALTER TABLE、CREATE INDEX。",
                    ),
                }),
                execute: async (input, options) =>
                  mcpTools.apply_migration.execute(input, options),
              }),
              true,
            );
          }
        } catch (e) {
          console.error("Failed to connect to Supabase MCP:", e);
        }

        allTools.loadSkill = withApproval(
          tool({
            description:
              "加载一个 Skill 的完整 SKILL.md 指令内容。当用户需求匹配 Available Skills Metadata 中某个 skill 的描述时，先调用此工具获取专门工作流说明。",
            inputSchema: z.object({
              name: z
                .string()
                .describe(
                  "要加载的 skill ID/name，例如 Available Skills Metadata 中的 ID。",
                ),
            }),
            execute: async ({ name }) => {
              const normalizedName = name.trim().toLowerCase();
              const matchedSkill = availableSkills.find((skill) => {
                return (
                  skill.id.toLowerCase() === normalizedName ||
                  skill.title.toLowerCase() === normalizedName
                );
              });

              if (!matchedSkill) {
                return {
                  error: `Skill '${name}' not found`,
                  availableSkills: availableSkills.map((skill) => ({
                    id: skill.id,
                    title: skill.title,
                    description: skill.description,
                  })),
                };
              }

              const skill = await getSkillById(
                matchedSkill.id,
                env,
                skillLoadOptions,
              );
              if (!skill?.enabled) {
                return { error: `Skill '${matchedSkill.id}' not found` };
              }

              return {
                skillId: skill.id,
                title: skill.title,
                description: skill.description,
                runtime: skill.runtime,
                skillDirectory: `${SKILLS_ROOT_PATH}/${skill.id}`,
                content: skill.instructions,
                entry: skill.entry,
                permissions: skill.permissions,
              };
            },
          }),
          false,
        );

        allTools.AskUserQuestion = withApproval(
          tool({
            description:
              "当需要向用户一次性确认多个有明确选项的问题时使用。前端会用可交互 tabs 和 checkbox 展示每个问题，用户可勾选答案并补充说明后发送。每个问题都要提供推荐答案。用户提交的结构化答案会写入工具审批响应的 reason JSON。",
            inputSchema: askUserQuestionSchema,
            execute: async (_input, options) => ({
              status: "submitted",
              response: extractToolApprovalReason(
                options.messages,
                options.toolCallId,
              ),
            }),
          }),
          true,
        );

        allTools.searchTG = tool({
          description:
            "搜索 Telegram 频道和 plugin 来源中的网盘资源链接（夸克、阿里云盘、百度网盘等）。默认同时开启 plugin 搜索。当用户想要搜索、查找影视剧、动漫、小说等资源时使用此工具。",
          inputSchema: z.object({
            keyword: z.string().describe("搜索关键词，例如影视剧名称"),
          }),
          execute: async ({ keyword }) => {
            const result = await search(
              keyword,
              undefined,
              "merged_by_type",
              true,
              undefined,
              env,
            );
            return result;
          },
        });
        allTools.finalAnswer = withApproval(
          tool({
            description:
              "当已经完成必要工具调用，并准备向用户输出最终答复时调用。调用后停止继续执行工具循环。",
            inputSchema: z.object({}),
            execute: async () => ({ status: "ready" }),
          }),
          false,
        );
        allTools.listRemoteFiles = withApproval(
          tool({
            description:
              "浏览 Supabase 远程文件系统中的目录内容，返回指定路径下的文件和子目录。适用于用户明确提到目录、路径、文件位置时。",
            inputSchema: remoteFileQueryPathSchema,
            execute: async ({ path }) => listRemoteFiles(path, env),
          }),
          false,
        );
        allTools.statRemotePath = withApproval(
          tool({
            description:
              "查看 Supabase 远程文件系统中某个路径的元数据，确认它是否存在、是文件还是目录，以及最近更新时间。",
            inputSchema: remoteFileQueryPathSchema,
            execute: async ({ path }) => statRemotePath(path, env),
          }),
          false,
        );
        allTools.readRemoteFile = withApproval(
          tool({
            description:
              "读取 Supabase 远程文件系统中的文本文件内容。适用于查看具体文档、说明文本或配置文件。",
            inputSchema: remoteFileQueryPathSchema,
            execute: async ({ path }) => readRemoteText(path, env),
          }),
          false,
        );
        allTools.writeRemoteFile = withApproval(
          tool({
            description:
              "在 Supabase 远程文件系统中创建或更新文本文件。适用于写入文档、说明、导出文本或配置文件。",
            inputSchema: remoteFileWriteSchema,
            execute: async (input) => writeRemoteText(input, env),
          }),
          true,
        );
        allTools.moveRemotePath = withApproval(
          tool({
            description:
              "在 Supabase 远程文件系统中移动或重命名文件、目录。适用于整理目录结构或调整文件名。",
            inputSchema: remoteFileMoveSchema,
            execute: async (input) => moveRemotePath(input, env),
          }),
          true,
        );
        allTools.deleteRemotePath = withApproval(
          tool({
            description:
              "删除 Supabase 远程文件系统中的文件或目录。适用于明确的文件清理请求。删除目录时需要显式传 recursive=true。",
            inputSchema: remoteFileDeleteSchema,
            execute: async (input) => deleteRemotePath(input, env),
          }),
          true,
        );
        allTools.createRemoteDirectory = withApproval(
          tool({
            description:
              "在 Supabase 远程文件系统中创建目录。适用于准备文档、导出文件或其他文本文件的存放路径。",
            inputSchema: remoteFileMkdirSchema,
            execute: async (input) => createRemoteDirectory(input, env),
          }),
          true,
        );

        const result = streamText({
          model: await getModel(modelId, env),
          system: systemPrompt,
          messages: await convertToModelMessages(messages, {
            convertDataPart: (part) => {
              if (isImageAttachmentPart(part)) {
                return modelConfig.supportsMultimodal
                  ? attachmentToImagePromptPart(part.data, env)
                  : {
                      type: "text",
                      text: attachmentToPromptText(part.data),
                    };
              }

              return undefined;
            },
          }),
          tools: allTools,
          providerOptions: thinkingEnabled
            ? undefined
            : {
                [modelConfig.providerCode.split(".")[0].trim()]: {
                  thinking: { type: "disabled" },
                },
              },
          stopWhen: [stepCountIs(15), hasToolCall("finalAnswer")],
          onFinish: async () => {
            if (mcpClient) {
              await mcpClient.close();
            }
          },
        });

        return withCors(
          result.toUIMessageStreamResponse({
            sendReasoning: true,
            sendSources: true,
          }),
        );
      },
    },
  },
});
