import { toast } from "sonner";

/**
 * Like `toast.promise`, but skips the loading toast entirely for operations that resolve
 * within `delay` ms. Avoids the janky flash of a loading → success transition for fast calls.
 * Only shows a loading indicator when the user would actually perceive the wait.
 */
export async function toastAsync<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((err: unknown) => string);
  },
  delay = 200,
): Promise<T> {
  let toastId: string | number | undefined;
  let settled = false;

  const timer = setTimeout(() => {
    if (!settled) toastId = toast.loading(messages.loading);
  }, delay);

  try {
    const result = await promise;
    settled = true;
    clearTimeout(timer);
    const msg =
      typeof messages.success === "function" ? messages.success(result) : messages.success;
    if (toastId !== undefined) toast.success(msg, { id: toastId });
    else toast.success(msg);
    return result;
  } catch (err) {
    settled = true;
    clearTimeout(timer);
    const msg = typeof messages.error === "function" ? messages.error(err) : messages.error;
    if (toastId !== undefined) toast.error(msg, { id: toastId });
    else toast.error(msg);
    throw err;
  }
}
