/**
 * Quick Open cross-connection intent (#1235).
 *
 * A Quick Open result can target a different connection than the window it was
 * invoked from. Each connection owns its own workspace window
 * (`workspace-{connId}`, sprint-361) and DOM CustomEvents never cross a window
 * boundary, so a cross-connection selection is delivered in two hops:
 *
 *   1. The origin window focuses / creates the target connection's window via
 *      `openWorkspaceWindow` (the per-conn window-focus command — no new
 *      `window-controls.ts` label was needed; that command already exists).
 *   2. The intent is broadcast on a Tauri event; the target window's Quick
 *      Open listener converts it back into the SAME local DOM CustomEvent
 *      (`reveal-schema` / `navigate-table` / `quickopen-function`) the existing
 *      App / SchemaTree handlers already consume — so nothing downstream needs
 *      to know delivery came from another window.
 *
 * Same-connection selections skip both hops and dispatch the DOM event
 * directly (see {@link dispatchLocalIntent}).
 *
 * Known ceiling: a target window that does not yet exist has a mount race — the
 * broadcast can land before the fresh window's listener registers, so the
 * action forward is best-effort for a not-yet-open connection (the window still
 * focuses/creates reliably). Guaranteed delivery to a fresh window would need a
 * persisted replay-on-mount and is left as follow-up.
 */
import { emit, listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** Serializable description of a Quick Open selection. */
export type QuickOpenIntent =
  | { kind: "schema"; connectionId: string; schema: string }
  | {
      kind: "function" | "procedure";
      connectionId: string;
      source: string;
      title: string;
    }
  | {
      kind: "table" | "view";
      connectionId: string;
      schema: string;
      table: string;
    };

/** Tauri event channel carrying a {@link QuickOpenIntent} across windows. */
export const QUICK_OPEN_INTENT_CHANNEL = "quick-open:intent";

/**
 * Fire the local DOM CustomEvent that the in-window handlers already consume.
 * Used by both the same-connection selection path and the cross-window
 * receiver so the mapping lives in exactly one place.
 */
export function dispatchLocalIntent(intent: QuickOpenIntent): void {
  switch (intent.kind) {
    case "schema":
      window.dispatchEvent(
        new CustomEvent("reveal-schema", {
          detail: { connectionId: intent.connectionId, schema: intent.schema },
        }),
      );
      return;
    case "function":
    case "procedure":
      window.dispatchEvent(
        new CustomEvent("quickopen-function", {
          detail: {
            connectionId: intent.connectionId,
            source: intent.source,
            title: intent.title,
          },
        }),
      );
      return;
    default:
      window.dispatchEvent(
        new CustomEvent("navigate-table", {
          detail: {
            connectionId: intent.connectionId,
            schema: intent.schema,
            table: intent.table,
            objectKind: intent.kind,
          },
        }),
      );
  }
}

/** Broadcast an intent to the connection's window (cross-window Tauri event). */
export async function forwardIntent(intent: QuickOpenIntent): Promise<void> {
  await emit(QUICK_OPEN_INTENT_CHANNEL, intent);
}

/**
 * Subscribe the current window to inbound intents. A broadcast reaches every
 * window (including the sender), so only intents whose `connectionId` matches
 * `ownConnId` are applied. Returns the Tauri unlisten fn.
 */
export function subscribeIntents(
  ownConnId: string,
  apply: (intent: QuickOpenIntent) => void = dispatchLocalIntent,
): Promise<UnlistenFn> {
  return listen<QuickOpenIntent>(QUICK_OPEN_INTENT_CHANNEL, (event) => {
    if (event.payload.connectionId === ownConnId) {
      apply(event.payload);
    }
  });
}
