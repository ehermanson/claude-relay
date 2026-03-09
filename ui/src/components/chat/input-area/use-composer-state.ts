import { useCallback, useEffect, useReducer, type RefObject, type SetStateAction } from "react";
import type { MentionEntry } from "./shared";
import type { ComposerEditorHandle } from "../composer-editor";

const drafts = new Map<string, string>();

interface ComposerState {
  draftText: string;
  composerSelectionOffset: number;
  pendingSelectionOffset: number | null;
  mentionEntries: MentionEntry[];
  selectedMentionKey: string | null;
  mentionMenuDismissed: boolean;
  selectedSlashKey: string | null;
  slashMenuDismissed: boolean;
}

type ComposerAction =
  | { type: "restore"; value: string }
  | { type: "update_draft"; value: string }
  | { type: "set_composer_value"; value: string; selectionOffset: number }
  | { type: "set_selection_offset"; value: number }
  | { type: "clear_pending_selection" }
  | { type: "set_mention_entries"; entries: MentionEntry[] }
  | {
      type: "set_selected_mention_key";
      value: string | null | ((current: string | null) => string | null);
    }
  | { type: "dismiss_mentions" }
  | { type: "reset_mentions" }
  | {
      type: "set_selected_slash_key";
      value: string | null | ((current: string | null) => string | null);
    }
  | { type: "dismiss_slash" }
  | { type: "reset_slash" }
  | { type: "reset_after_send" };

const INITIAL_STATE: ComposerState = {
  draftText: "",
  composerSelectionOffset: 0,
  pendingSelectionOffset: null,
  mentionEntries: [],
  selectedMentionKey: null,
  mentionMenuDismissed: false,
  selectedSlashKey: null,
  slashMenuDismissed: false,
};

function reducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "restore":
      return {
        ...INITIAL_STATE,
        draftText: action.value,
        composerSelectionOffset: action.value.length,
        pendingSelectionOffset: action.value.length,
      };
    case "update_draft":
      return {
        ...state,
        draftText: action.value,
        mentionMenuDismissed: false,
        slashMenuDismissed: false,
      };
    case "set_composer_value":
      return {
        ...state,
        draftText: action.value,
        composerSelectionOffset: action.selectionOffset,
        pendingSelectionOffset: action.selectionOffset,
        mentionMenuDismissed: false,
        slashMenuDismissed: false,
      };
    case "set_selection_offset":
      return {
        ...state,
        composerSelectionOffset: action.value,
      };
    case "clear_pending_selection":
      return {
        ...state,
        pendingSelectionOffset: null,
      };
    case "set_mention_entries":
      return {
        ...state,
        mentionEntries: action.entries,
      };
    case "set_selected_mention_key":
      return {
        ...state,
        selectedMentionKey:
          typeof action.value === "function"
            ? action.value(state.selectedMentionKey)
            : action.value,
      };
    case "dismiss_mentions":
      return {
        ...state,
        mentionEntries: [],
        selectedMentionKey: null,
        mentionMenuDismissed: true,
      };
    case "reset_mentions":
      return {
        ...state,
        mentionEntries: [],
        selectedMentionKey: null,
        mentionMenuDismissed: false,
      };
    case "set_selected_slash_key":
      return {
        ...state,
        selectedSlashKey:
          typeof action.value === "function" ? action.value(state.selectedSlashKey) : action.value,
      };
    case "dismiss_slash":
      return {
        ...state,
        selectedSlashKey: null,
        slashMenuDismissed: true,
      };
    case "reset_slash":
      return {
        ...state,
        selectedSlashKey: null,
        slashMenuDismissed: false,
      };
    case "reset_after_send":
      return {
        ...INITIAL_STATE,
      };
    default:
      return state;
  }
}

export function useComposerState(
  instanceId: string,
  composerRef: RefObject<ComposerEditorHandle | null>,
) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    const restored = drafts.get(instanceId) || "";
    dispatch({ type: "restore", value: restored });
    composerRef.current?.focus();
  }, [composerRef, instanceId]);

  const persistDraft = useCallback(
    (value: string) => {
      if (value) {
        drafts.set(instanceId, value);
      } else {
        drafts.delete(instanceId);
      }
    },
    [instanceId],
  );

  const updateDraft = useCallback(
    (value: string) => {
      persistDraft(value);
      dispatch({ type: "update_draft", value });
    },
    [persistDraft],
  );

  const setComposerValue = useCallback(
    (value: string, selectionOffset = value.length) => {
      persistDraft(value);
      dispatch({ type: "set_composer_value", value, selectionOffset });
      composerRef.current?.focus();
    },
    [composerRef, persistDraft],
  );

  const resetAfterSend = useCallback(() => {
    drafts.delete(instanceId);
    dispatch({ type: "reset_after_send" });
  }, [instanceId]);

  return {
    ...state,
    updateDraft,
    setComposerValue,
    setComposerSelectionOffset: useCallback(
      (value: number) => dispatch({ type: "set_selection_offset", value }),
      [],
    ),
    clearPendingSelectionOffset: useCallback(
      () => dispatch({ type: "clear_pending_selection" }),
      [],
    ),
    setMentionEntries: useCallback(
      (entries: MentionEntry[]) => dispatch({ type: "set_mention_entries", entries }),
      [],
    ),
    setSelectedMentionKey: useCallback(
      (value: SetStateAction<string | null>) =>
        dispatch({
          type: "set_selected_mention_key",
          value,
        }),
      [],
    ),
    dismissMentionMenu: useCallback(() => dispatch({ type: "dismiss_mentions" }), []),
    resetMentionMenu: useCallback(() => dispatch({ type: "reset_mentions" }), []),
    setSelectedSlashKey: useCallback(
      (value: SetStateAction<string | null>) =>
        dispatch({
          type: "set_selected_slash_key",
          value,
        }),
      [],
    ),
    dismissSlashMenu: useCallback(() => dispatch({ type: "dismiss_slash" }), []),
    resetSlashMenu: useCallback(() => dispatch({ type: "reset_slash" }), []),
    resetAfterSend,
  };
}
