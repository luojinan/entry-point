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

type ToolStateTone = "running" | "approval" | "denied" | "error" | "success";

const TOOL_STATE_META = {
  running: "调用中",
  approval: "需要确认执行",
  denied: "已拒绝执行",
  error: "工具调用失败",
  success: "工具调用完成",
} satisfies Record<ToolStateTone, string>;

function getInputStringValue(input: unknown, key: string): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getToolDisplayLabel(part: DynamicToolUIPart): string {
  if (part.toolName === "AskUserQuestion") {
    return "向用户确认";
  }

  if (part.toolName === "loadSkill") {
    const skillName = getInputStringValue(part.input, "name");
    return skillName ? `skill · 查看 ${skillName}` : "skill · 查看";
  }

  return `工具 · ${part.toolName}`;
}

function ToolStatusLine({
  label,
  state,
  children,
}: {
  label: string;
  state: ToolStateTone;
  children?: ReactNode;
}) {
  const status = TOOL_STATE_META[state];
  const visibleText = state === "success" ? label : `${status} · ${label}`;

  return (
    <div
      className="min-w-0 space-y-2 text-muted-foreground text-sm"
      aria-label={`${status}: ${label}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          icon={AiSettingIcon}
          size={16}
          strokeWidth={2}
          className="shrink-0"
        />
        <span className="min-w-0 truncate">{visibleText}</span>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">{children}</div>
      ) : null}
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
  const label = getToolDisplayLabel(part);

  if (part.toolName === "AskUserQuestion") {
    if (part.state === "approval-requested") {
      return <ToolStatusLine label="等待用户回答" state="approval" />;
    }

    if (part.state === "output-denied") {
      return <ToolStatusLine label={label} state="denied" />;
    }

    if (part.state === "output-error") {
      return <ToolStatusLine label={label} state="error" />;
    }

    return <ToolStatusLine label="已提交回答" state="success" />;
  }

  if (part.state === "input-streaming" || part.state === "input-available") {
    return <ToolStatusLine label={label} state="running" />;
  }

  if (part.state === "approval-requested") {
    return (
      <ToolStatusLine label={label} state="approval">
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
      </ToolStatusLine>
    );
  }

  if (part.state === "output-denied") {
    return <ToolStatusLine label={label} state="denied" />;
  }

  if (part.state === "output-error") {
    return <ToolStatusLine label={label} state="error" />;
  }

  return <ToolStatusLine label={label} state="success" />;
}
