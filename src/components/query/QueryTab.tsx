import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@components/ui/button";
import type { EditorView } from "@codemirror/view";
import type { QueryTab } from "@stores/tabStore";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { executeQuery, cancelQuery } from "@lib/tauri";
import { splitSqlStatements, formatSql, uglifySql } from "@lib/sqlUtils";
import { useSqlAutocomplete } from "@hooks/useSqlAutocomplete";
import { useResizablePanel } from "@hooks/useResizablePanel";
import QueryEditor from "./QueryEditor";
import QueryResultGrid from "./QueryResultGrid";
import FavoritesPanel from "./FavoritesPanel";
import {
  Play,
  Square,
  Loader2,
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Paintbrush,
  Star,
  Save,
  X,
} from "lucide-react";

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const updateQueryState = useTabStore((s) => s.updateQueryState);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const clearHistory = useQueryHistoryStore((s) => s.clearHistory);
  const historyEntries = useQueryHistoryStore((s) => s.entries);
  const schemaNamespace = useSqlAutocomplete(tab.connectionId);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);

  const handleSaveFavorite = useCallback(() => {
    const name = favoriteName.trim();
    const sql = tab.sql.trim();
    if (!name || !sql) return;
    addFavorite(name, sql, tab.connectionId);
    setFavoriteName("");
    setShowSaveForm(false);
  }, [favoriteName, tab.sql, tab.connectionId, addFavorite]);

  const handleLoadFavoriteSql = useCallback(
    (sql: string) => {
      updateQuerySql(tab.id, sql);
    },
    [tab.id, updateQuerySql],
  );

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

    const statements = splitSqlStatements(sql).filter((stmt) => {
      // Strip SQL comments and whitespace to detect statements that are
      // effectively empty (e.g. "-- comment only" or "/* block */").
      // Line comments: -- ... (to end of line)
      // Block comments: /* ... */
      let s = stmt;
      s = s.replace(/--[^\n]*/g, "");
      s = s.replace(/\/\*[\s\S]*?\*\//g, "");
      return s.trim().length > 0;
    });
    if (statements.length === 0) return;

    // Single statement — use original behavior
    if (statements.length === 1) {
      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
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
                  ? {
                      ...t,
                      queryState: { status: "completed" as const, result },
                    }
                  : t,
              ),
            };
          }
          return state;
        });
        addHistoryEntry({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "success",
          connectionId: tab.connectionId,
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
        addHistoryEntry({
          sql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "error",
          connectionId: tab.connectionId,
        });
      }
      return;
    }

    // Multiple statements — execute sequentially
    const queryId = `${tab.id}-${Date.now()}`;
    const startTime = Date.now();
    updateQueryState(tab.id, { status: "running", queryId });

    let lastResult: import("@/types/query").QueryResult | null = null;
    const errors: string[] = [];

    for (const stmt of statements) {
      const stmtQueryId = `${queryId}-${statements.indexOf(stmt)}`;
      try {
        const result = await executeQuery(tab.connectionId, stmt, stmtQueryId);
        lastResult = result;
      } catch (err) {
        errors.push(
          `Statement ${statements.indexOf(stmt) + 1}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    useTabStore.setState((state) => {
      const current = state.tabs.find((t) => t.id === tab.id);
      if (
        current &&
        current.type === "query" &&
        current.queryState.status === "running" &&
        "queryId" in current.queryState &&
        current.queryState.queryId === queryId
      ) {
        if (errors.length > 0) {
          return {
            tabs: state.tabs.map((t) =>
              t.id === tab.id && t.type === "query"
                ? {
                    ...t,
                    queryState: {
                      status: "error" as const,
                      error: errors.join("\n"),
                    },
                  }
                : t,
            ),
          };
        }
        return {
          tabs: state.tabs.map((t) =>
            t.id === tab.id && t.type === "query" && lastResult
              ? {
                  ...t,
                  queryState: {
                    status: "completed" as const,
                    result: lastResult,
                  },
                }
              : t,
          ),
        };
      }
      return state;
    });

    addHistoryEntry({
      sql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: errors.length > 0 ? "error" : "success",
      connectionId: tab.connectionId,
    });
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

  // Format SQL event listener (Cmd+I) — supports selection-only formatting
  useEffect(() => {
    const handler = () => {
      // Only format if this tab is the active tab
      const { activeTabId } = useTabStore.getState();
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

      const formatted = formatSql(tab.sql);
      updateQuerySql(tab.id, formatted);
    };
    window.addEventListener("format-sql", handler);
    return () => window.removeEventListener("format-sql", handler);
  }, [tab.id, tab.sql, updateQuerySql]);

  // Uglify SQL event listener (Cmd+Shift+I)
  useEffect(() => {
    const handler = () => {
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
      if (!tab.sql.trim()) return;
      const uglified = uglifySql(tab.sql);
      updateQuerySql(tab.id, uglified);
    };
    window.addEventListener("uglify-sql", handler);
    return () => window.removeEventListener("uglify-sql", handler);
  }, [tab.id, tab.sql, updateQuerySql]);

  // Toggle favorites panel event listener (Cmd+Shift+F)
  useEffect(() => {
    const handler = () => {
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
      setShowFavorites((v) => !v);
      setShowSaveForm(false);
    };
    window.addEventListener("toggle-favorites", handler);
    return () => window.removeEventListener("toggle-favorites", handler);
  }, [tab.id]);

  const editorRef = useRef<EditorView | null>(null);

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

    const formatted = formatSql(tab.sql);
    updateQuerySql(tab.id, formatted);
  }, [tab.id, tab.sql, updateQuerySql]);

  // Resizable split state
  const containerRef = useRef<HTMLDivElement>(null);
  const { size: editorPct, handleMouseDown: handleResizeMouseDown } =
    useResizablePanel({
      axis: "vertical",
      min: 10,
      max: 90,
      initial: 50,
      percentage: true,
      containerRef,
    });

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-secondary px-2 py-1">
        {tab.queryState.status === "running" ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleExecute}
            aria-label="Cancel query"
          >
            <Square className="text-destructive" />
            <Loader2 className="animate-spin" />
            <span>Cancel</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleExecute}
            disabled={!tab.sql.trim()}
            aria-label="Run query"
          >
            <Play className="text-success" />
            <span>Run</span>
            <span className="text-[10px] text-muted-foreground">
              {"\u2318\u23CE"}
            </span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={handleFormat}
          disabled={!tab.sql.trim()}
          aria-label="Format SQL"
          title="Format SQL (Cmd+I)"
        >
          <Paintbrush />
          <span>Format</span>
        </Button>
        <div className="ml-auto flex items-center gap-1 relative">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setShowSaveForm(!showSaveForm);
              setShowFavorites(false);
            }}
            disabled={!tab.sql.trim()}
            aria-label="Save to favorites"
            title="Save to favorites"
          >
            <Star />
            <span>Save</span>
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setShowFavorites(!showFavorites);
              setShowSaveForm(false);
            }}
            aria-label="Open favorites"
            title="Favorites (Cmd+Shift+F)"
          >
            <Star className="text-primary" />
            <span>
              Favorites{favorites.length > 0 ? ` (${favorites.length})` : ""}
            </span>
          </Button>
          {showSaveForm && (
            <div className="absolute right-0 top-full mt-1 z-50 flex items-center gap-1 rounded border border-border bg-background p-2 shadow-lg">
              <input
                type="text"
                value={favoriteName}
                onChange={(e) => setFavoriteName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveFavorite();
                  if (e.key === "Escape") setShowSaveForm(false);
                }}
                placeholder="Favorite name..."
                className="h-6 w-40 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
                autoFocus
              />
              <Button
                size="xs"
                onClick={handleSaveFavorite}
                disabled={!favoriteName.trim()}
                aria-label="Confirm save"
              >
                <Save />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowSaveForm(false);
                  setFavoriteName("");
                }}
                aria-label="Cancel save"
              >
                <X />
              </Button>
            </div>
          )}
          {showFavorites && (
            <div className="absolute right-0 top-full mt-1 z-50">
              <FavoritesPanel
                connectionId={tab.connectionId}
                onLoadSql={handleLoadFavoriteSql}
                onClose={() => setShowFavorites(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div
        className="min-h-0 overflow-hidden"
        style={{ flex: `0 0 ${editorPct}%` }}
      >
        <QueryEditor
          ref={editorRef}
          sql={tab.sql}
          onSqlChange={(sql) => updateQuerySql(tab.id, sql)}
          onExecute={handleExecute}
          schemaNamespace={schemaNamespace}
        />
      </div>

      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize shrink-0 border-y border-border hover:bg-primary/90 active:bg-primary/90"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Result area — flex column so QueryResultGrid's flex-1 children fill
          the remaining height and the inner table can actually scroll. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <QueryResultGrid
          queryState={tab.queryState}
          connectionId={tab.connectionId}
          sql={tab.sql}
          onAfterCommit={handleExecute}
        />
      </div>

      {/* History panel */}
      {historyEntries.length > 0 && (
        <div className="border-t border-border bg-secondary">
          <Button
            variant="ghost"
            size="xs"
            className="w-full justify-start text-secondary-foreground"
            onClick={() => setHistoryExpanded((v) => !v)}
          >
            {historyExpanded ? <ChevronDown /> : <ChevronRight />}
            <Clock />
            <span>History ({historyEntries.length})</span>
          </Button>
          {historyExpanded && (
            <div className="max-h-40 overflow-y-auto">
              {historyEntries.map((entry) => (
                <Button
                  key={entry.id}
                  variant="ghost"
                  size="xs"
                  className="w-full justify-start gap-2 border-t border-border px-3 py-1 text-left font-normal rounded-none h-auto"
                  onClick={() => updateQuerySql(tab.id, entry.sql)}
                  aria-label={entry.sql}
                >
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      entry.status === "success"
                        ? "bg-success"
                        : "bg-destructive"
                    }`}
                  />
                  <span className="truncate font-mono text-foreground">
                    {entry.sql}
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {entry.duration}ms
                  </span>
                </Button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end border-t border-border px-2 py-0.5">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={clearHistory}
              aria-label="Clear history"
            >
              <Trash2 />
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
