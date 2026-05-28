import { AiSettingIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DynamicToolUIPart } from "ai";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type ToolApprovalHandler = (opts: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

const TOOL_DENIED_REASON =
  "The user explicitly denied this tool execution request. 用户明确拒绝执行该工具调用。Treat this as a user refusal, not a tool error. Do not retry unless the user later clearly approves it.";

function ToolStatusLine({
  toolName,
  status,
  children,
}: {
  toolName: string;
  status: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
      <HugeiconsIcon
        icon={AiSettingIcon}
        size={16}
        strokeWidth={2}
        className="shrink-0"
      />
      <span className="min-w-0 truncate">
        {status} · {toolName}
      </span>
      {children}
    </div>
  );
}

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
    return <ToolStatusLine toolName={part.toolName} status="调用中" />;
  }

  if (part.state === "approval-requested") {
    return (
      <ToolStatusLine toolName={part.toolName} status="需要确认执行">
        <div className="ml-auto flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onApproval({
                id: part.approval.id,
                approved: false,
                reason: TOOL_DENIED_REASON,
              });
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
      </ToolStatusLine>
    );
  }

  if (part.state === "output-denied") {
    return <ToolStatusLine toolName={part.toolName} status="已拒绝执行" />;
  }

  if (part.state === "output-error") {
    return <ToolStatusLine toolName={part.toolName} status="工具调用失败" />;
  }

  return <ToolStatusLine toolName={part.toolName} status="工具调用完成" />;
}
