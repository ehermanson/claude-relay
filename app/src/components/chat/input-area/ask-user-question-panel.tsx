import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import type { UserInputQuestion } from "@shared/types";

interface AskUserQuestionPanelProps {
  questions: UserInputQuestion[];
  selectedAnswers: Record<string, string>;
  onSelectOption: (questionId: string, answer: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AskUserQuestionPanel({
  questions,
  selectedAnswers,
  onSelectOption,
  collapsed = false,
  onToggleCollapse,
}: AskUserQuestionPanelProps) {
  if (questions.length === 0) return null;

  const answeredCount = questions.filter(
    (q, i) => !!selectedAnswers[q.id || `question-${i}`],
  ).length;

  return (
    <div className="border-b border-border/80">
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-surface-hover"
        >
          <ChevronDown
            size={13}
            strokeWidth={2.5}
            className={`shrink-0 text-muted transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className="text-[0.75rem] font-medium text-muted">
            {questions.length === 1 ? "1 question" : `${questions.length} questions`}
          </span>
          {answeredCount > 0 ? (
            <span className="ml-auto text-[0.6875rem] text-muted">
              {answeredCount}/{questions.length} answered
            </span>
          ) : null}
        </button>
      ) : null}

      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.div
            key="questions-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="max-h-[50vh] overflow-y-auto">
              {questions.map((question, questionIndex) => {
                const questionId = question.id || `question-${questionIndex}`;
                const selectedAnswer = selectedAnswers[questionId] ?? null;
                const options = question.options ?? [];

                return (
                  <section
                    key={questionId}
                    className={questionIndex > 0 ? "border-t border-border/70" : ""}
                  >
                    <div className="px-3.5 pt-3 pb-2">
                      {question.header ? (
                        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-muted">
                          {question.header}
                        </p>
                      ) : null}
                      <h3 className="mt-1.5 text-[0.8125rem] font-medium tracking-[-0.015em] text-text">
                        {question.question}
                      </h3>
                    </div>

                    {options.length > 0 ? (
                      <div className="pb-1.5">
                        {options.map((option, optionIndex) => {
                          const isSelected = selectedAnswer === option.label;
                          return (
                            <button
                              key={`${questionId}-${option.label}-${optionIndex}`}
                              type="button"
                              onClick={() => onSelectOption(questionId, option.label)}
                              className={`flex w-full items-start gap-2.5 px-3.5 py-1.5 text-left transition-colors ${
                                isSelected ? "bg-accent/8" : "hover:bg-accent/5"
                              }`}
                            >
                              <span
                                className={`mt-px inline-flex size-[1.375rem] shrink-0 items-center justify-center rounded-md border text-[0.6875rem] font-medium tabular-nums ${
                                  isSelected
                                    ? "border-accent/40 bg-accent text-white"
                                    : "border-border/70 bg-surface text-muted"
                                }`}
                              >
                                {optionIndex + 1}
                              </span>
                              <span className="min-w-0">
                                <span
                                  className={`block text-[0.8125rem] font-medium tracking-[-0.01em] ${
                                    isSelected ? "text-accent" : "text-text"
                                  }`}
                                >
                                  {option.label}
                                </span>
                                {option.description ? (
                                  <span className="mt-0.5 block text-[0.6875rem] leading-snug text-muted">
                                    {option.description}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
