import { useCallback, useEffect } from "react";
import type { QueryTab } from "../stores/tabStore";
import { useTabStore } from "../stores/tabStore";
import { executeQuery, cancelQuery } from "../lib/tauri";
import QueryEditor from "./QueryEditor";
import QueryResultGrid from "./QueryResultGrid";

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const updateQueryState = useTabStore((s) => s.updateQueryState);

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
              t.id === tab.id && t.type === "query" ? { ...t, queryState: { status: "completed" as const, result } } : t,
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
                ? { ...t, queryState: { status: "error" as const, error: err instanceof Error ? err.message : String(err) } }
                : t,
            ),
          };
        }
        return state;
      });
    }
  }, [tab.id, tab.sql, tab.queryState.status, tab.connectionId]);

  // Listen for cancel-query events (Cmd+.)
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Editor area */}
      <div className="flex-1 min-h-0 border-b border-(--color-border)" style={{ flex: "1 1 50%" }}>
        <QueryEditor
          sql={tab.sql}
          onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
          onExecute={handleExecute}
        />
      </div>

      {/* Result area */}
      <div className="flex-1 min-h-0" style={{ flex: "1 1 50%" }}>
        <QueryResultGrid queryState={tab.queryState} />
      </div>
    </div>
  );
}
