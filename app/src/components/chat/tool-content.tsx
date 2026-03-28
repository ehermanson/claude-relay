/**
 * Rich content renderers for individual tool calls.
 * Extracted from activity-entry.tsx for cleaner separation.
 */

import { useState } from "react";
import { ActivityCodeBlock, DiffView, langFromPath } from "@/components/chat/activity-code";
import type { UserInputAnswer } from "@shared/types";

// ── AskUserQuestion ──────────────────────────────────────────────────

interface AskUserQuestionContentProps {
  input: Record<string, unknown>;
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
  resolution?: "approved" | "dismissed" | "feedback";
}

export function AskUserQuestionContent({
  input,
  onSendMessage,
  onAnswerUserInput,
  isInteractive,
}: AskUserQuestionContentProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const requestId = typeof input.requestId === "string" ? input.requestId : null;
  const questions = input.questions as
    | Array<{
        id?: string;
        question?: string;
        header?: string;
        options?: Array<{ label?: string; description?: string }>;
        isOther?: boolean;
      }>
    | undefined;

  if (!questions?.length) return null;

  const isManagedPrompt = !!requestId && !!onAnswerUserInput;
  const canClick = isInteractive && !!onSendMessage && !isManagedPrompt && selectedKey === null;
  const canRespond = isInteractive && isManagedPrompt && !submitted;

  const answerForQuestion = (questionId: string) => {
    if (selectedAnswers[questionId] === "__other__") {
      const other = otherAnswers[questionId]?.trim();
      return other ? [other] : [];
    }
    const selected = selectedAnswers[questionId];
    return selected ? [selected] : [];
  };

  const canSubmit =
    canRespond &&
    questions.every((question, index) => {
      const questionId = question.id || `question-${index}`;
      return answerForQuestion(questionId).length > 0;
    });

  return (
    <div className="mt-2 flex flex-col gap-2">
      {questions.map((q, qi) => {
        const questionId = q.id || `question-${qi}`;
        const selectedAnswer = selectedAnswers[questionId];
        const showOther = q.isOther && selectedAnswer === "__other__";

        return (
          <div key={qi} className="overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border bg-panel-header px-3 py-2 text-[0.8125rem] font-medium text-text">
              {q.header && (
                <span className="mr-2 rounded-md bg-claude-dim px-2 py-0.5 text-[0.6875rem] font-medium text-claude">
                  {q.header}
                </span>
              )}
              {q.question}
            </div>
            {q.options && (
              <div className="flex flex-col">
                {q.options.map((opt, oi) => {
                  const key = `${qi}-${oi}`;
                  const optionLabel = opt.label;
                  const isSelected = isManagedPrompt
                    ? selectedAnswer === optionLabel
                    : selectedKey === key;
                  const isDimmed = !isManagedPrompt && selectedKey !== null && !isSelected;
                  return (
                    <div
                      key={oi}
                      className={`flex items-baseline gap-2.5 border-b border-border px-3 py-2 transition-all last:border-b-0 ${
                        canClick || canRespond ? "cursor-pointer hover:bg-accent/5" : ""
                      } ${isDimmed ? "opacity-35" : ""} ${isSelected ? "bg-accent/5" : ""}`}
                      onClick={
                        optionLabel
                          ? () => {
                              if (canClick) {
                                setSelectedKey(key);
                                setSubmitted(true);
                                onSendMessage!(optionLabel);
                                return;
                              }
                              if (canRespond) {
                                setSelectedAnswers((prev) => ({
                                  ...prev,
                                  [questionId]: optionLabel,
                                }));
                              }
                            }
                          : undefined
                      }
                    >
                      <span className="text-[0.75rem] tabular-nums text-muted/60">{oi + 1}.</span>
                      <span
                        className={`text-[0.8125rem] font-medium ${isSelected ? "text-accent" : "text-text"}`}
                      >
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="text-[0.75rem] text-muted">{opt.description}</span>
                      )}
                      {isSelected && !isManagedPrompt && (
                        <span className="ml-auto rounded-md bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent">
                          sent
                        </span>
                      )}
                    </div>
                  );
                })}
                {q.isOther && (
                  <div className="border-b border-border px-3 py-2 last:border-b-0">
                    <button
                      type="button"
                      className={`rounded-md px-2 py-1 text-[0.75rem] font-medium transition-colors ${
                        selectedAnswer === "__other__"
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:bg-accent/5 hover:text-text"
                      }`}
                      onClick={
                        canRespond
                          ? () =>
                              setSelectedAnswers((prev) => ({
                                ...prev,
                                [questionId]: "__other__",
                              }))
                          : undefined
                      }
                    >
                      Other
                    </button>
                    {showOther && (
                      <input
                        type="text"
                        value={otherAnswers[questionId] ?? ""}
                        onChange={(e) =>
                          setOtherAnswers((prev) => ({
                            ...prev,
                            [questionId]: e.target.value,
                          }))
                        }
                        placeholder="Type your answer"
                        className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-[0.8125rem] text-text placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none"
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {isManagedPrompt && (canRespond || submitted) && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (!requestId || !onAnswerUserInput) return;
              const answers = Object.fromEntries(
                questions.map((question, index) => {
                  const questionId = question.id || `question-${index}`;
                  return [questionId, { answers: answerForQuestion(questionId) }];
                }),
              ) as Record<string, UserInputAnswer>;
              setSubmitted(true);
              onAnswerUserInput(requestId, answers);
            }}
            className="rounded-lg bg-accent/10 px-3.5 py-1.5 text-[0.8125rem] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Submit
          </button>
          <button
            type="button"
            disabled={!canRespond}
            onClick={() => {
              if (!requestId || !onAnswerUserInput) return;
              setSubmitted(true);
              onAnswerUserInput(requestId, {});
            }}
            className="rounded-lg px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          >
            Dismiss
          </button>
          {submitted && (
            <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-medium text-accent">
              sent
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── PermissionDenied ─────────────────────────────────────────────────

interface PermissionDeniedContentProps {
  tool: string;
  onApproveTool?: (tool: string) => void;
  isInteractive?: boolean;
  approvedTools?: Set<string>;
}

export function PermissionDeniedContent({
  tool,
  onApproveTool,
  isInteractive,
  approvedTools,
}: PermissionDeniedContentProps) {
  const [approved, setApproved] = useState(false);
  const alreadyApproved = approvedTools?.has(tool) ?? false;
  const canClick = isInteractive && !!onApproveTool && !approved && !alreadyApproved;

  return (
    <div className="mt-2 flex items-center gap-2">
      {canClick ? (
        <button
          onClick={() => {
            setApproved(true);
            onApproveTool!(tool);
          }}
          className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-1.5 text-[0.8125rem] font-medium text-warning transition-colors hover:border-warning/40 hover:bg-warning/15"
        >
          Allow {tool}
        </button>
      ) : approved || alreadyApproved ? (
        <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[0.75rem] font-medium text-accent">
          Allowed
        </span>
      ) : null}
    </div>
  );
}

// ── ToolContent (rich body for expanded tool entries) ─────────────────

interface ToolContentProps {
  tool: string;
  input: Record<string, unknown>;
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
  resolution?: "approved" | "dismissed" | "feedback";
}

export function ToolContent({
  tool,
  input,
  onSendMessage,
  onAnswerUserInput,
  isInteractive,
  resolution,
}: ToolContentProps) {
  switch (tool) {
    case "Edit": {
      const oldStr = input.old_string as string | undefined;
      const newStr = input.new_string as string | undefined;
      const filePath = (input.file_path as string) || undefined;
      if (oldStr != null && newStr != null) {
        return (
          <DiffView
            oldStr={oldStr}
            newStr={newStr}
            filePath={filePath}
            lang={langFromPath(filePath)}
          />
        );
      }
      return null;
    }
    case "Write": {
      const content = input.content as string | undefined;
      const filePath = (input.file_path as string) || undefined;
      if (content) {
        return (
          <ActivityCodeBlock content={content} label={filePath} lang={langFromPath(filePath)} />
        );
      }
      return null;
    }
    case "Bash": {
      const command = input.command as string | undefined;
      if (command) {
        return (
          <ActivityCodeBlock
            content={command}
            label={input.description as string | undefined}
            lang="bash"
          />
        );
      }
      return null;
    }
    case "Read": {
      const filePath = (input.file_path as string) || undefined;
      if (filePath) {
        const parts = [];
        if (input.offset) parts.push(`offset: ${input.offset}`);
        if (input.limit) parts.push(`limit: ${input.limit}`);
        const extra = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return <ActivityCodeBlock content={filePath + extra} />;
      }
      return null;
    }
    case "Grep": {
      const pattern = input.pattern as string | undefined;
      if (pattern) {
        const parts = [`pattern: ${pattern}`];
        if (input.path) parts.push(`path: ${input.path}`);
        if (input.glob) parts.push(`glob: ${input.glob}`);
        return <ActivityCodeBlock content={parts.join("\n")} />;
      }
      return null;
    }
    case "Glob": {
      const pattern = input.pattern as string | undefined;
      if (pattern) {
        const parts = [`pattern: ${pattern}`];
        if (input.path) parts.push(`path: ${input.path}`);
        return <ActivityCodeBlock content={parts.join("\n")} />;
      }
      return null;
    }
    case "ExitPlanMode": {
      return (
        <div className="mt-1.5">
          {resolution === "approved" && (
            <span className="inline-block w-fit rounded-md bg-accent/15 px-2 py-0.5 text-[0.75rem] font-medium text-accent">
              Approved
            </span>
          )}
          {(resolution === "feedback" || resolution === "dismissed") && (
            <span className="inline-block w-fit rounded-md bg-warning/15 px-2 py-0.5 text-[0.75rem] font-medium text-warning">
              {resolution === "dismissed" ? "Dismissed" : "Changes requested"}
            </span>
          )}
        </div>
      );
    }
    case "AskUserQuestion":
      return (
        <AskUserQuestionContent
          input={input}
          onSendMessage={onSendMessage}
          onAnswerUserInput={onAnswerUserInput}
          isInteractive={isInteractive}
        />
      );
    default:
      return null;
  }
}
