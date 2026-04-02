import { RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { fetchSpaceContext } from "@/lib/api";

export function SpaceContextPanel({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient();

  const { data: content, isLoading } = useQuery({
    queryKey: ["spaceContext", spaceId],
    queryFn: () => fetchSpaceContext(spaceId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (isLoading && content === undefined) {
    return (
      <div className="flex items-center justify-center p-6 text-xs text-muted">Loading...</div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted">
        <p>No shared context yet.</p>
        <p className="text-muted/60">
          Chats in this space will update{" "}
          <code className="text-text/60">.relay/space-context.md</code> as they work.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
        <span className="text-[0.6875rem] font-medium text-muted">space-context.md</span>
        <button
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: ["spaceContext", spaceId] })
          }
          className="rounded p-1 text-muted transition-colors hover:bg-surface-hover hover:text-text"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="p-3 text-sm leading-relaxed text-text/80">
        <MarkdownContent text={content} />
      </div>
    </div>
  );
}
