import { useCallback, useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { cancelQuery } from "@lib/tauri";
import { formatSql, uglifySql } from "@lib/sql/sqlUtils";
import type { QueryTab } from "@stores/workspaceStore";

/**
 * `QueryTab` 의 window event listener + handleFormat 캡슐화.
 *
 * 책임:
 *   - `cancel-query` listener — 외부 (예: keyboard shortcut layer) 가
 *     dispatch 하면 현재 running queryId 매칭 시 backend cancel 호출.
 *   - `format-sql` listener (Cmd+I) — active tab + 비-document 일 때만
 *     formatter 호출. 선택영역 있으면 선택영역만 포맷, 없으면 전체.
 *   - `uglify-sql` listener (Cmd+Shift+I) — 동일 활성 조건 + 전체 minify.
 *   - `handleFormat` callback — toolbar Format 버튼이 직접 호출 (선택
 *     영역 우선 + 전체 fallback).
 *   - `editorRef` — CodeMirror EditorView ref. SqlQueryEditor /
 *     MongoQueryEditor 가 받음, format/uglify 핸들러가 selection 조회.
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

  // cancel-query event listener — backend cancel 호출
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
