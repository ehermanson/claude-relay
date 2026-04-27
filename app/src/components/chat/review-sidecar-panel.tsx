import { Suspense, lazy } from "react";
import { Check, ChevronDown, Plus, RefreshCw, Send } from "lucide-react";
import type { InstanceInfo } from "@shared/types";
import { findProviderModelLabel, getProviderDisplayName } from "@shared/provider-catalog";
import { Menu } from "@/components/ui/menu";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatTimeAgo } from "@/lib/utils";

const CompactInstanceView = lazy(() =>
  import("./instance-view").then((mod) => ({ default: mod.InstanceView })),
);

function getReviewerLabel(review: InstanceInfo): string {
  if (review.preferredModel) {
    return findProviderModelLabel(review.provider, review.preferredModel) ?? review.preferredModel;
  }
  return getProviderDisplayName(review.provider);
}

function ReviewMetaRow({ review, dense }: { review: InstanceInfo; dense?: boolean }) {
  const reviewerLabel = getReviewerLabel(review);
  const ageLabel = formatTimeAgo(review.createdAt);
  const gap = dense ? "gap-2" : "gap-2.5";
  return (
    <div className={`flex min-w-0 items-center ${gap} text-xs text-muted`}>
      <span className="flex min-w-0 shrink items-center gap-1 text-text">
        <ProviderLogo provider={review.provider} className="h-3 w-3 shrink-0" muted />
        <span className="truncate">{reviewerLabel}</span>
      </span>
      {ageLabel ? (
        <>
          <span aria-hidden="true" className="text-border">
            ·
          </span>
          <span className="shrink-0 text-muted">{ageLabel}</span>
        </>
      ) : null}
    </div>
  );
}

export function ReviewSidecarPanel({
  reviewInstanceId,
  reviews,
  sourceChat,
  onSelectReview,
  onSendToChat,
  onReReview,
  onNewReview,
  showReReview,
}: {
  reviewInstanceId?: string;
  reviews: InstanceInfo[];
  sourceChat: { id: string; name: string };
  onSelectReview: (reviewInstanceId: string) => void;
  onSendToChat: (reviewInstanceId: string) => void;
  onReReview: (reviewInstanceId: string) => void;
  onNewReview?: () => void;
  showReReview?: boolean;
}) {
  if (!reviewInstanceId) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
        No review attached.
      </div>
    );
  }

  const activeReview = reviews.find((review) => review.id === reviewInstanceId) ?? null;
  const hasHistory = reviews.length > 1;
  const activeIndex = activeReview
    ? reviews.findIndex((review) => review.id === activeReview.id)
    : -1;

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner size={16} />
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="border-b border-border/80 px-3 py-1.5">
          {activeReview ? (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {hasHistory ? (
                  <Menu.Root>
                    <Menu.Trigger className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-hover">
                      <div className="min-w-0 flex-1">
                        <ReviewMetaRow review={activeReview} dense />
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] tabular-nums text-muted">
                        <span>
                          {activeIndex >= 0 ? activeIndex + 1 : 1}/{reviews.length}
                        </span>
                        <ChevronDown size={12} strokeWidth={2} />
                      </span>
                    </Menu.Trigger>
                    <Menu.Content side="bottom" align="start" className="min-w-[18rem]">
                      {reviews.map((review) => {
                        const selected = review.id === reviewInstanceId;
                        return (
                          <Menu.Item key={review.id} onClick={() => onSelectReview(review.id)}>
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <ReviewMetaRow review={review} />
                            </div>
                            {selected ? (
                              <Check size={14} strokeWidth={2.5} className="shrink-0" />
                            ) : null}
                          </Menu.Item>
                        );
                      })}
                    </Menu.Content>
                  </Menu.Root>
                ) : (
                  <div className="px-1 py-1">
                    <ReviewMetaRow review={activeReview} dense />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {showReReview ? (
                  <Tooltip content="Re-review with latest changes">
                    <button
                      type="button"
                      onClick={() => onReReview(activeReview.id)}
                      disabled={activeReview.status === "processing"}
                      className="flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-[0.6875rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:text-muted/50"
                    >
                      <RefreshCw size={10} strokeWidth={2} />
                      Re-review
                    </button>
                  </Tooltip>
                ) : null}
                <Tooltip content="Send review findings to source chat">
                  <button
                    type="button"
                    onClick={() => onSendToChat(activeReview.id)}
                    disabled={activeReview.status === "processing"}
                    className={`flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                      activeReview.status === "processing"
                        ? "cursor-not-allowed text-muted/50"
                        : "text-muted hover:bg-surface-hover hover:text-text"
                    }`}
                  >
                    <Send size={10} strokeWidth={2} />
                    Send to chat
                  </button>
                </Tooltip>
                {onNewReview ? (
                  <Tooltip content="Start a new review">
                    <button
                      type="button"
                      onClick={onNewReview}
                      className="flex items-center rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <Plus size={13} strokeWidth={2} />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <CompactInstanceView
          key={reviewInstanceId}
          instanceId={reviewInstanceId}
          compact
          embeddedSourceChat={sourceChat}
        />
      </div>
    </Suspense>
  );
}
