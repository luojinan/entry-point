import { createMCPClient } from "@ai-sdk/mcp";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ToolSet,
  tool,
} from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai-provider";
import { handleCorsPreflightRequest, withCors } from "@/lib/api-utils";
import {
  type ChatImageAttachment,
  type ChatMessage,
  isImageAttachmentPart,
} from "@/lib/chat-message";
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

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleCorsPreflightRequest(request),

      POST: async ({ request }) => {
        const {
          messages,
          model: modelId,
        }: { messages: ChatMessage[]; model?: string } = await request.json();

        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null =
          null;
        let allTools: ToolSet = {};

        try {
          mcpClient = await createMCPClient({
            transport: {
              type: "http",
              url: `https://mcp.supabase.com/mcp?project_ref=${process.env.SUPABASE_PROJECT_REF}`,
              headers: {
                Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
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
          allTools = { ...(mcpTools as ToolSet) };
        } catch (e) {
          console.error("Failed to connect to Supabase MCP:", e);
        }

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
            );
            return result;
          },
        });

        const result = streamText({
          model: getModel(modelId),
          system:
            "你是一个有用的 AI 助手，擅长回答各类问题、提供建议和帮助用户完成任务。当用户需要搜索影视、动漫、小说等资源时，请使用 searchTG 工具搜索 Telegram 频道。搜索结果会按网盘类型（quark/aliyun/baidu 等）分组返回，请以清晰易读的格式展示给用户，优先展示夸克网盘链接。当用户消息包含图片 OCR 内容时，请优先结合用户问题和 OCR 文本回答，并明确提醒 OCR 可能存在误差；如果 OCR 文本明显缺失、错乱或不完整，要建议用户重新上传更清晰的图片。对于其他一般问题，直接用自身知识回答即可。",
          messages: await convertToModelMessages(messages, {
            convertDataPart: (part) => {
              if (isImageAttachmentPart(part)) {
                return {
                  type: "text",
                  text: attachmentToPromptText(part.data),
                };
              }

              return undefined;
            },
          }),
          tools: allTools,
          stopWhen: stepCountIs(5),
          onFinish: async () => {
            if (mcpClient) {
              await mcpClient.close();
            }
          },
        });

        return withCors(result.toUIMessageStreamResponse());
      },
    },
  },
});
