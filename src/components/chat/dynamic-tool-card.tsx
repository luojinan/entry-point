import type { DynamicToolUIPart } from "ai";
import { ToolLoadingCard } from "@/components/chat/tool-loading-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DynamicToolCard({ part }: { part: DynamicToolUIPart }) {
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "call-streaming"
  ) {
    return <ToolLoadingCard label={`调用 ${part.toolName}...`} />;
  }

  if (part.state === "output-error") {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>{part.toolName}</CardTitle>
          <CardDescription className="text-destructive">
            工具调用失败
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-destructive text-sm">
            {String(part.error ?? "未知错误")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{part.toolName}</CardTitle>
        <CardDescription>工具调用结果</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="max-h-40 overflow-auto text-xs">
          {JSON.stringify(part.output, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
