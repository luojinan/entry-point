import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface AskUserQuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AskUserQuestionItem {
  id: string;
  question: string;
  description?: string;
  selectionMode: "single" | "multiple";
  required: boolean;
  options: AskUserQuestionOption[];
}

export interface AskUserQuestionInput {
  title: string;
  description?: string;
  questions: AskUserQuestionItem[];
}

export type AskUserQuestionAnswers = Record<string, string[]>;

const SINGLE_CHOICE_ADVANCE_DELAY_MS = 220;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOption(value: unknown, index: number): AskUserQuestionOption {
  if (typeof value === "string") {
    return {
      id: `option-${index + 1}`,
      label: value,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      id: `option-${index + 1}`,
      label: `选项 ${index + 1}`,
    };
  }

  const record = value as Record<string, unknown>;
  const label =
    readString(record.label) ||
    readString(record.text) ||
    readString(record.value) ||
    `选项 ${index + 1}`;

  return {
    id:
      readString(record.id) ||
      readString(record.value) ||
      `option-${index + 1}`,
    label,
    description: readString(record.description) || undefined,
    recommended:
      record.recommended === true ||
      record.isRecommended === true ||
      record.default === true,
  };
}

function normalizeQuestion(
  value: unknown,
  index: number,
): AskUserQuestionItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const options = Array.isArray(record.options)
    ? record.options.map(normalizeOption)
    : [];
  if (options.length === 0) {
    return null;
  }

  const selectionMode =
    record.selectionMode === "multiple" || record.allowMultiple === true
      ? "multiple"
      : "single";

  return {
    id: readString(record.id) || `question-${index + 1}`,
    question:
      readString(record.question) ||
      readString(record.title) ||
      `问题 ${index + 1}`,
    description: readString(record.description) || undefined,
    selectionMode,
    required: record.required !== false,
    options,
  };
}

export function normalizeAskUserQuestionInput(
  input: unknown,
): AskUserQuestionInput | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const questions = Array.isArray(record.questions)
    ? record.questions
        .map((question, index) => normalizeQuestion(question, index))
        .filter((question): question is AskUserQuestionItem => !!question)
    : [];

  if (questions.length === 0) {
    return null;
  }

  return {
    title: readString(record.title) || "需要你确认几个问题",
    description: readString(record.description) || undefined,
    questions,
  };
}

export function createInitialAskUserQuestionAnswers(
  questions: AskUserQuestionItem[],
) {
  return Object.fromEntries(
    questions.map((question) => {
      const recommendedOptionIds = question.options
        .filter((option) => option.recommended)
        .map((option) => option.id);

      return [
        question.id,
        question.selectionMode === "single"
          ? recommendedOptionIds.slice(0, 1)
          : recommendedOptionIds,
      ];
    }),
  );
}

export function getUnansweredRequiredAskUserQuestions(params: {
  input: AskUserQuestionInput;
  answers: AskUserQuestionAnswers;
}) {
  const { input, answers } = params;
  return input.questions.filter(
    (question) =>
      question.required && (answers[question.id]?.length ?? 0) === 0,
  );
}

export function formatAskUserQuestionAnswersForReason(params: {
  input: AskUserQuestionInput;
  answers: AskUserQuestionAnswers;
  note: string;
}) {
  const { input, answers, note } = params;
  const questions = input.questions.map((question) => {
    const selectedOptionIds = answers[question.id] ?? [];
    const selectedOptions = question.options.filter((option) =>
      selectedOptionIds.includes(option.id),
    );

    return {
      id: question.id,
      question: question.question,
      selectionMode: question.selectionMode,
      selectedOptionIds,
      selectedOptions: selectedOptions.map((option) => ({
        id: option.id,
        label: option.label,
      })),
    };
  });

  return JSON.stringify(
    {
      type: "AskUserQuestionResponse",
      title: input.title,
      questions,
      additionalInfo: note.trim(),
    },
    null,
    2,
  );
}

export function AskUserQuestionForm({
  input,
  answers,
  onAnswersChange,
  className,
  headerAction,
}: {
  input: unknown;
  answers: AskUserQuestionAnswers;
  onAnswersChange: (answers: AskUserQuestionAnswers) => void;
  className?: string;
  headerAction?: ReactNode;
}) {
  const normalizedInput = useMemo(
    () => normalizeAskUserQuestionInput(input),
    [input],
  );
  const [activeQuestionId, setActiveQuestionId] = useState(
    normalizedInput?.questions[0]?.id ?? "",
  );
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAdvanceTimeout() {
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
  }

  useEffect(() => clearAdvanceTimeout, []);

  if (!normalizedInput) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="font-medium">需要用户确认</div>
        <div className="mt-1 text-muted-foreground">
          工具参数格式不完整，无法渲染选项。
        </div>
      </div>
    );
  }

  function toggleAnswer(question: AskUserQuestionItem, optionId: string) {
    clearAdvanceTimeout();

    const currentValue = answers[question.id] ?? [];
    const isSelected = currentValue.includes(optionId);

    onAnswersChange(
      (() => {
        const current = answers;
        const nextValue =
          question.selectionMode === "single"
            ? isSelected
              ? []
              : [optionId]
            : isSelected
              ? currentValue.filter((id) => id !== optionId)
              : [...currentValue, optionId];

        return {
          ...current,
          [question.id]: nextValue,
        };
      })(),
    );

    const questionIndex = normalizedInput.questions.findIndex(
      (item) => item.id === question.id,
    );
    const nextQuestion = normalizedInput.questions[questionIndex + 1];

    if (question.selectionMode !== "single" || isSelected || !nextQuestion) {
      return;
    }

    advanceTimeoutRef.current = setTimeout(() => {
      setActiveQuestionId(nextQuestion.id);
      advanceTimeoutRef.current = null;
    }, SINGLE_CHOICE_ADVANCE_DELAY_MS);
  }

  return (
    <div
      className={cn(
        "w-full rounded-xl border bg-background p-3 text-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 font-medium">
            {normalizedInput.title}
          </div>
          {headerAction ? (
            <div className="-mt-1 -mr-1 shrink-0">{headerAction}</div>
          ) : null}
        </div>
        {normalizedInput.description ? (
          <div className="text-muted-foreground text-xs leading-relaxed">
            {normalizedInput.description}
          </div>
        ) : null}
      </div>

      <Tabs
        className="mt-3"
        value={activeQuestionId}
        onValueChange={(value) => {
          clearAdvanceTimeout();
          setActiveQuestionId(String(value));
        }}
      >
        <TabsList className="max-w-full flex-wrap justify-start">
          {normalizedInput.questions.map((question, index) => {
            const answered = (answers[question.id]?.length ?? 0) > 0;
            return (
              <TabsTrigger
                key={question.id}
                value={question.id}
                onClick={() => setActiveQuestionId(question.id)}
                className="min-w-0 flex-none"
              >
                <span>问题 {index + 1}</span>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    answered ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                />
              </TabsTrigger>
            );
          })}
        </TabsList>

        {normalizedInput.questions.map((question, index) => (
          <TabsContent key={question.id} value={question.id} className="mt-3">
            <FieldSet>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <FieldLegend className="text-sm">
                    {index + 1}. {question.question}
                  </FieldLegend>
                  {question.description ? (
                    <FieldDescription>{question.description}</FieldDescription>
                  ) : null}
                </div>
                <Badge variant="secondary">
                  {question.selectionMode === "multiple" ? "可多选" : "单选"}
                </Badge>
              </div>

              <FieldGroup className="gap-2">
                {question.options.map((option) => {
                  const checked = (answers[question.id] ?? []).includes(
                    option.id,
                  );

                  return (
                    <Field
                      key={option.id}
                      orientation="horizontal"
                      className={cn(
                        "rounded-lg border bg-background px-3 py-2 transition-colors",
                        checked && "border-primary bg-primary/5",
                      )}
                    >
                      <Checkbox
                        id={`${question.id}-${option.id}`}
                        checked={checked}
                        onCheckedChange={() =>
                          toggleAnswer(question, option.id)
                        }
                      />
                      <FieldContent>
                        <FieldLabel
                          htmlFor={`${question.id}-${option.id}`}
                          className="w-full font-normal"
                        >
                          {option.label}
                          {option.recommended ? (
                            <span className="text-muted-foreground">
                              (推荐)
                            </span>
                          ) : null}
                        </FieldLabel>
                        {option.description ? (
                          <FieldDescription className="text-xs">
                            {option.description}
                          </FieldDescription>
                        ) : null}
                      </FieldContent>
                    </Field>
                  );
                })}
              </FieldGroup>
            </FieldSet>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
