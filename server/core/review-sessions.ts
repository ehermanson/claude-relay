import type { InstanceInfo } from "#core/types.js";

export function reviewBelongsToSource(source: InstanceInfo, candidate: InstanceInfo): boolean {
  const review = candidate.review;
  if (!review) return false;
  if (review.sourceInstanceId === source.id) return true;
  return (
    !!review.sourceSessionId &&
    !!source.sessionId &&
    review.sourceSessionId === source.sessionId &&
    candidate.workingDirectory === source.workingDirectory
  );
}

export function compareReviewRecency(a: InstanceInfo, b: InstanceInfo): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return b.lastActivityAt - a.lastActivityAt;
}

export function pickPreferredAttachedReview(
  source: InstanceInfo,
  candidates: InstanceInfo[],
  preferredId?: string,
): InstanceInfo | undefined {
  const matches = candidates
    .filter((candidate) => reviewBelongsToSource(source, candidate))
    .sort(compareReviewRecency);
  if (matches.length === 0) return undefined;
  if (preferredId) {
    const preferred = matches.find((candidate) => candidate.id === preferredId);
    if (preferred) return preferred;
  }
  return matches[0];
}

export function attachReviewLinks(infos: InstanceInfo[]): InstanceInfo[] {
  const preferredSelections = new Map(infos.map((info) => [info.id, info.reviewInstanceId]));
  for (const info of infos) {
    info.reviewInstanceId = undefined;
  }
  for (const info of infos) {
    const preferred = pickPreferredAttachedReview(info, infos, preferredSelections.get(info.id));
    if (preferred) {
      info.reviewInstanceId = preferred.id;
    }
  }
  return infos;
}

export function getAttachedReviewIds(
  source: InstanceInfo,
  candidates: InstanceInfo[],
  excludingId?: string,
): string[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.id !== source.id &&
        candidate.id !== excludingId &&
        reviewBelongsToSource(source, candidate),
    )
    .sort(compareReviewRecency)
    .map((candidate) => candidate.id);
}
