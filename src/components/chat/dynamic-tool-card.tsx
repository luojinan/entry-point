import type { DynamicToolUIPart } from "ai";
import { ToolLoadingCard } from "@/components/chat/tool-loading-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ToolApprovalHandler = (opts: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

export function DynamicToolCard({
  part,
  onApproval,
}: {
  part: DynamicToolUIPart;
  onApproval: ToolApprovalHandler;
}) {
  if (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "call-streaming"
  ) {
    return <ToolLoadingCard label={`调用 ${part.toolName}...`} />;
  }

  if (part.state === "approval-requested") {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>{part.toolName}</CardTitle>
          <CardDescription>需要确认执行</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(part.input, null, 2)}
          </pre>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onApproval({ id: part.approval.id, approved: false });
              }}
            >
              拒绝
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApproval({ id: part.approval.id, approved: true });
              }}
            >
              同意执行
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (part.state === "output-denied") {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>{part.toolName}</CardTitle>
          <CardDescription className="text-muted-foreground">
            已拒绝执行
          </CardDescription>
        </CardHeader>
      </Card>
    );
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
