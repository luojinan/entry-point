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

const tools = {
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

export type ChatTools = InferUITools<typeof tools>;
export type ChatMessage = UIMessage<never, never, ChatTools>;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages }: { messages: UIMessage[] } = await request.json();

        const result = streamText({
          model: getModel(),
          system:
            "你是一个有用的 AI 助手。当用户询问天气时，使用天气工具查询。当需要数学计算时，使用计算工具。",
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(5),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
