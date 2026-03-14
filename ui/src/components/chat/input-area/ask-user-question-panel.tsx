import type { UserInputQuestion } from "@shared/types";

interface AskUserQuestionPanelProps {
  questions: UserInputQuestion[];
  selectedAnswers: Record<string, string>;
  onSelectOption: (questionId: string, answer: string) => void;
}

export function AskUserQuestionPanel({
  questions,
  selectedAnswers,
  onSelectOption,
}: AskUserQuestionPanelProps) {
  if (questions.length === 0) return null;

  return (
    <div className="border-b border-border/80">
      {questions.map((question, questionIndex) => {
        const questionId = question.id || `question-${questionIndex}`;
        const selectedAnswer = selectedAnswers[questionId] ?? null;
        const options = question.options ?? [];

        return (
          <section
            key={questionId}
            className={questionIndex > 0 ? "border-t border-border/70" : ""}
          >
            <div className="px-4 pt-4 pb-3">
              {question.header ? (
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-muted">
                  {question.header}
                </p>
              ) : null}
              <h3 className="mt-2 text-[0.95rem] font-medium tracking-[-0.015em] text-text">
                {question.question}
              </h3>
            </div>

            {options.length > 0 ? (
              <div className="pb-2">
                {options.map((option, optionIndex) => {
                  const isSelected = selectedAnswer === option.label;
                  return (
                    <button
                      key={`${questionId}-${option.label}-${optionIndex}`}
                      type="button"
                      onClick={() => onSelectOption(questionId, option.label)}
                      className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? "bg-accent/8" : "hover:bg-accent/5"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[0.8125rem] font-medium tabular-nums ${
                          isSelected
                            ? "border-accent/40 bg-accent text-white"
                            : "border-border/70 bg-surface text-muted"
                        }`}
                      >
                        {optionIndex + 1}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-[0.875rem] font-medium tracking-[-0.01em] ${
                            isSelected ? "text-accent" : "text-text"
                          }`}
                        >
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="mt-0.5 block text-[0.78125rem] leading-snug text-muted">
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
  );
}
