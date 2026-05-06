import {
  getReviewInstanceIdFromRuntimePayload,
  getReviewSessionFromRuntimePayload,
} from "#core/session-context.js";
import type { ManagedInstanceRow } from "#core/db.js";
import type { ProviderModelOptions } from "#core/types.js";

function parseJsonValue<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function parseManagedRestoreState(entry: ManagedInstanceRow): {
  resumeCursor: unknown;
  runtimePayload: Record<string, unknown> | undefined;
  review: ReturnType<typeof getReviewSessionFromRuntimePayload>;
  reviewInstanceId: string | undefined;
  modelOptions: ProviderModelOptions | undefined;
} {
  const runtimePayload = parseJsonValue<Record<string, unknown>>(entry.runtime_payload_json);
  return {
    resumeCursor: parseJsonValue<unknown>(entry.resume_cursor_json),
    runtimePayload,
    review: getReviewSessionFromRuntimePayload(runtimePayload),
    reviewInstanceId: getReviewInstanceIdFromRuntimePayload(runtimePayload),
    modelOptions: parseJsonValue<ProviderModelOptions>(entry.model_options_json),
  };
}
