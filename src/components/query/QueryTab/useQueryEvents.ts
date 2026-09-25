import type { EditorView } from "@codemirror/view";
import { formatSql, uglifySql } from "@lib/sql/sqlUtils";
import { cancelQuery } from "@lib/tauri";
import type { QueryTab } from "@stores/workspaceStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useCallback, useEffect, useRef } from "react";

/**
 * Encapsulates the `QueryTab` window event listeners + handleFormat.
 *
 * Responsibilities:
 *   - `cancel-query` listener — when something outside (e.g. the keyboard
 *     shortcut layer) dispatches it, call the backend cancel if the
 *     running queryId matches.
 *   - `format-sql` listener (Cmd+I) — call the formatter only on the
 *     active, non-document tab. Format the selection if there is one,
 *     otherwise the whole text.
 *   - `uglify-sql` listener (Cmd+Shift+I) — same active condition, minify
 *     the whole text.
 *   - `handleFormat` callback — called directly by the toolbar Format
 *     button (selection first, whole text as fallback).
 *   - `editorRef` — CodeMirror EditorView ref. SqlQueryEditor /
 *     MongoQueryEditor receive it; the format/uglify handlers read the
 *     selection through it.
 *
 * Invariants:
 * - format / uglify short-circuit on document paradigm — running a JSON
 *   body through the SQL formatter corrupts it.
 * - Listeners only fire on the active tab (`activeTabId === tab.id`) so
 *   inactive tabs ignore the global shortcuts.
 * - The cancel-query handler swallows `cancelQuery` rejections by design
 *   (best-effort, the UI must not block on a backend that's already
 *   gone).
 */

export interface UseQueryEventsArgs {
  tab: QueryTab;
  updateQuerySql: (tabId: string, sql: string) => void;
  canCancelQuery: boolean;
}

export interface QueryEvents {
  editorRef: React.RefObject<EditorView | null>;
  handleFormat: () => void;
}

/**
 * User-initiated whole-doc replacement (format / uglify). Dispatched on the
 * EditorView so it lands on the undo stack — standard editor UX. This is the
 * deliberate counterpart to the passive `syncEditorDocument` mirror, which
 * suppresses history. The editor's updateListener propagates the change back
 * into the store, so no direct `updateQuerySql` call is needed here (#1248).
 */
function replaceEditorDoc(view: EditorView, next: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
  });
}

export function useQueryEvents({
  tab,
  updateQuerySql,
  canCancelQuery,
}: UseQueryEventsArgs): QueryEvents {
  const editorRef = useRef<EditorView | null>(null);

  // cancel-query event listener — calls the backend cancel
  useEffect(() => {
    const handler = (e: Event) => {
      const { queryId } = (e as CustomEvent<{ queryId: string }>).detail;
      if (
        canCancelQuery &&
        tab.queryState.status === "running" &&
        "queryId" in tab.queryState &&
        tab.queryState.queryId === queryId
      ) {
        cancelQuery(queryId).catch(() => {
          // Query may have already completed
        });
      }
    };
    window.addEventListener("cancel-query", handler);
    return () => window.removeEventListener("cancel-query", handler);
  }, [canCancelQuery, tab.id, tab.queryState]);

  // Format SQL event listener (Cmd+I) — supports selection-only formatting.
  // Skipped on document paradigm tabs; JSON bodies should not be run through
  // the SQL formatter.
  useEffect(() => {
    if (tab.paradigm === "document") return;
    const handler = () => {
      // Only format if this tab is the active tab
      const wsState = useWorkspaceStore.getState();
      // Resolve the currently focused workspace's active tab id. Listeners
      // fire on every tab subscribed; gating on the FOCUSED workspace's
      // activeTabId ensures only the visible tab responds.
      const focusedConnId =
        // The focused conn lives on connectionStore but we can derive
        // active tab id by scanning every workspace; for the format/uglify
        // shortcuts what matters is "is THIS tab the active one in ITS
        // workspace?" Original behavior gated on global activeTabId.
        Object.values(wsState.workspaces).flatMap((byDb) =>
          Object.values(byDb).map((ws) => ws.activeTabId),
        );
      const activeTabId = focusedConnId.find((id) => id === tab.id) ?? null;
      if (activeTabId !== tab.id) return;
      if (!tab.sql.trim()) return;

      // If the editor has a selection, format only the selection
      const view = editorRef.current;
      if (view) {
        const { from, to } = view.state.selection.main;
        if (from !== to) {
          const selectedText = view.state.sliceDoc(from, to);
          const formatted = formatSql(selectedText);
          view.dispatch({
            changes: { from, to, insert: formatted },
          });
          return;
        }
      }

      // Whole-doc format is user-initiated → dispatch on the editor so Cmd+Z
      // reverts it. Fall back to the store only when no editor is mounted.
      const formatted = formatSql(tab.sql);
      if (view) replaceEditorDoc(view, formatted);
      else updateQuerySql(tab.id, formatted);
    };
    window.addEventListener("format-sql", handler);
    return () => window.removeEventListener("format-sql", handler);
  }, [tab.id, tab.sql, tab.paradigm, updateQuerySql]);

  // Uglify SQL event listener (Cmd+Shift+I). Also skipped for document tabs.
  useEffect(() => {
    if (tab.paradigm === "document") return;
    const handler = () => {
      const wsState = useWorkspaceStore.getState();
      // Resolve the currently focused workspace's active tab id. Listeners
      // fire on every tab subscribed; gating on the FOCUSED workspace's
      // activeTabId ensures only the visible tab responds.
      const focusedConnId =
        // The focused conn lives on connectionStore but we can derive
        // active tab id by scanning every workspace; for the format/uglify
        // shortcuts what matters is "is THIS tab the active one in ITS
        // workspace?" Original behavior gated on global activeTabId.
        Object.values(wsState.workspaces).flatMap((byDb) =>
          Object.values(byDb).map((ws) => ws.activeTabId),
        );
      const activeTabId = focusedConnId.find((id) => id === tab.id) ?? null;
      if (activeTabId !== tab.id) return;
      if (!tab.sql.trim()) return;
      // Uglify is user-initiated → dispatch on the editor so Cmd+Z reverts it.
      const uglified = uglifySql(tab.sql);
      const view = editorRef.current;
      if (view) replaceEditorDoc(view, uglified);
      else updateQuerySql(tab.id, uglified);
    };
    window.addEventListener("uglify-sql", handler);
    return () => window.removeEventListener("uglify-sql", handler);
  }, [tab.id, tab.sql, tab.paradigm, updateQuerySql]);

  const handleFormat = useCallback(() => {
    if (!tab.sql.trim()) return;

    // If the editor has a selection, format only the selection
    const view = editorRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (from !== to) {
        const selectedText = view.state.sliceDoc(from, to);
        const formatted = formatSql(selectedText);
        view.dispatch({
          changes: { from, to, insert: formatted },
        });
        return;
      }
    }

    // Whole-doc format is user-initiated → dispatch on the editor so Cmd+Z
    // reverts it. Fall back to the store only when no editor is mounted.
    const formatted = formatSql(tab.sql);
    if (view) replaceEditorDoc(view, formatted);
    else updateQuerySql(tab.id, formatted);
  }, [tab.id, tab.sql, updateQuerySql]);

  return { editorRef, handleFormat };
}
