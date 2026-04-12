import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryTab } from "../stores/tabStore";
import { useTabStore } from "../stores/tabStore";
import { executeQuery, cancelQuery } from "../lib/tauri";
import { useSqlAutocomplete } from "../hooks/useSqlAutocomplete";
import QueryEditor from "./QueryEditor";
import QueryResultGrid from "./QueryResultGrid";
import { Play, Square, Loader2 } from "lucide-react";

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const updateQueryState = useTabStore((s) => s.updateQueryState);
  const schemaNamespace = useSqlAutocomplete(tab.connectionId);

  const handleExecute = useCallback(async () => {
    const sql = tab.sql.trim();
    if (!sql) return;

    // If already running, cancel
    if (tab.queryState.status === "running") {
      try {
        await cancelQuery(tab.queryState.queryId);
      } catch {
        // Query may have already completed
      }
      return;
    }

    const queryId = `${tab.id}-${Date.now()}`;
    updateQueryState(tab.id, { status: "running", queryId });

    try {
      const result = await executeQuery(tab.connectionId, sql, queryId);
      // Only update if this is still the active query (prevent stale overwrites)
      useTabStore.setState((state) => {
        const current = state.tabs.find((t) => t.id === tab.id);
        if (
          current &&
          current.type === "query" &&
          current.queryState.status === "running" &&
          "queryId" in current.queryState &&
          current.queryState.queryId === queryId
        ) {
          return {
            tabs: state.tabs.map((t) =>
              t.id === tab.id && t.type === "query"
                ? { ...t, queryState: { status: "completed" as const, result } }
                : t,
            ),
          };
        }
        return state;
      });
    } catch (err) {
      useTabStore.setState((state) => {
        const current = state.tabs.find((t) => t.id === tab.id);
        if (
          current &&
          current.type === "query" &&
          current.queryState.status === "running" &&
          "queryId" in current.queryState &&
          current.queryState.queryId === queryId
        ) {
          return {
            tabs: state.tabs.map((t) =>
              t.id === tab.id && t.type === "query"
                ? {
                    ...t,
                    queryState: {
                      status: "error" as const,
                      error: err instanceof Error ? err.message : String(err),
                    },
                  }
                : t,
            ),
          };
        }
        return state;
      });
    }
  }, [tab.id, tab.sql, tab.queryState.status, tab.connectionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handler = (e: Event) => {
      const { queryId } = (e as CustomEvent<{ queryId: string }>).detail;
      if (
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
  }, [tab.id, tab.queryState]);

  // Resizable split state
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startY: number; startEditorPct: number } | null>(
    null,
  );
  const [editorPct, setEditorPct] = useState(50);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startY: e.clientY, startEditorPct: editorPct };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizeRef.current || !containerRef.current) return;
        const containerHeight = containerRef.current.clientHeight;
        const delta = moveEvent.clientY - resizeRef.current.startY;
        const newPct = Math.max(
          10,
          Math.min(
            90,
            resizeRef.current.startEditorPct + (delta / containerHeight) * 100,
          ),
        );
        setEditorPct(newPct);
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [editorPct],
  );

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-(--color-border) bg-(--color-bg-secondary) px-2 py-1">
        {tab.queryState.status === "running" ? (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
            onClick={handleExecute}
            aria-label="Cancel query"
          >
            <Square size={12} className="text-(--color-danger)" />
            <Loader2 size={12} className="animate-spin" />
            <span>Cancel</span>
          </button>
        ) : (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--color-text-secondary) hover:bg-(--color-bg-tertiary) disabled:opacity-40"
            onClick={handleExecute}
            disabled={!tab.sql.trim()}
            aria-label="Run query"
          >
            <Play size={12} className="text-(--color-success)" />
            <span>Run</span>
            <span className="text-[10px] text-(--color-text-muted)">
              {"\u2318\u23CE"}
            </span>
          </button>
        )}
      </div>

      {/* Editor area */}
      <div
        className="min-h-0 overflow-hidden"
        style={{ flex: `0 0 ${editorPct}%` }}
      >
        <QueryEditor
          sql={tab.sql}
          onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
          onExecute={handleExecute}
          schemaNamespace={schemaNamespace}
        />
      </div>

      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize shrink-0 border-y border-(--color-border) hover:bg-(--color-accent) active:bg-(--color-accent)"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Result area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <QueryResultGrid queryState={tab.queryState} />
      </div>
    </div>
  );
}
