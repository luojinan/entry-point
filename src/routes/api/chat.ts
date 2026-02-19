import { createMCPClient } from "@ai-sdk/mcp";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { getModel } from "@/lib/ai-provider";

export type ChatMessage = UIMessage;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages }: { messages: UIMessage[] } = await request.json();

        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null =
          null;
        let allTools: Record<string, unknown> = {};

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
          const mcpTools = await mcpClient.tools();
          for (const toolName of Object.keys(mcpTools)) {
            mcpTools[toolName].needsApproval = true;
          }
          allTools = { ...mcpTools };
        } catch (e) {
          console.error("Failed to connect to Supabase MCP:", e);
        }

        const result = streamText({
          model: getModel(),
          system:
            "你是一个有用的 AI 助手。你可以查询和操作 Supabase 数据库（包括查看表结构、执行 SQL 查询、搜索 Supabase 文档等）。请根据用户需求选择合适的工具。",
          messages: await convertToModelMessages(messages),
          tools: allTools,
          stopWhen: stepCountIs(5),
          onFinish: async () => {
            if (mcpClient) {
              await mcpClient.close();
            }
          },
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
