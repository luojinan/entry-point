import { createMCPClient } from "@ai-sdk/mcp";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  type InferUITools,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai-provider";

const localTools = {
  weather: tool({
    description: "查询指定城市的天气信息",
    inputSchema: z.object({
      location: z.string().describe('城市名称，如"北京"、"上海"'),
    }),
    execute: async ({ location }) => {
      const temperature = Math.round(Math.random() * 30 + 5);
      const conditions = ["晴", "多云", "小雨", "阴"][
        Math.floor(Math.random() * 4)
      ];
      return { location, temperature, conditions, unit: "°C" };
    },
  }),
  calculate: tool({
    description: "执行数学计算",
    inputSchema: z.object({
      expression: z.string().describe('要计算的数学表达式，如 "2 + 3 * 4"'),
    }),
    execute: async ({ expression }) => {
      try {
        const result = new Function(`return ${expression}`)();
        return { expression, result: Number(result) };
      } catch {
        return { expression, error: "无法计算该表达式" };
      }
    },
  }),
};

export type ChatTools = InferUITools<typeof localTools>;
export type ChatMessage = UIMessage<never, never, ChatTools>;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages }: { messages: UIMessage[] } = await request.json();

        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null =
          null;
        let allTools: Record<string, unknown> = { ...localTools };

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
          allTools = { ...localTools, ...mcpTools };
        } catch (e) {
          console.error("Failed to connect to Supabase MCP:", e);
        }

        const result = streamText({
          model: getModel(),
          system:
            "你是一个有用的 AI 助手。你可以查询天气、执行数学计算，还可以查询和操作 Supabase 数据库（包括查看表结构、执行 SQL 查询、搜索 Supabase 文档等）。请根据用户需求选择合适的工具。",
          messages: await convertToModelMessages(messages),
          tools: allTools as typeof localTools,
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
