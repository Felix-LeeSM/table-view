import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import type { EditorView } from "@codemirror/view";
import type { QueryTab, QueryMode } from "@stores/tabStore";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  executeQuery,
  cancelQuery,
  findDocuments,
  aggregateDocuments,
} from "@lib/tauri";
import { splitSqlStatements, formatSql, uglifySql } from "@lib/sqlUtils";
import { databaseTypeToSqlDialect } from "@lib/sqlDialect";
import { useSqlAutocomplete } from "@hooks/useSqlAutocomplete";
import { useResizablePanel } from "@hooks/useResizablePanel";
import QueryEditor from "./QueryEditor";
import QueryResultGrid from "./QueryResultGrid";
import FavoritesPanel from "./FavoritesPanel";
import SqlSyntax from "@components/shared/SqlSyntax";
import type { FindBody } from "@/types/document";
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
  CornerDownLeft,
} from "lucide-react";

// ─── Document paradigm helpers ─────────────────────────────────────────────
// Document-paradigm query tabs execute raw JSON that the backend consumes
// as MongoDB find bodies or aggregation pipelines. The backend requires
// `database` + `collection`, so we surface a clear error whenever the tab
// is missing that context instead of silently failing the `invoke` call.

interface DocumentQueryContext {
  database: string;
  collection: string;
}

function readDocumentContext(tab: QueryTab): DocumentQueryContext | null {
  if (!tab.database || !tab.collection) return null;
  return { database: tab.database, collection: tab.collection };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

interface QueryTabProps {
  tab: QueryTab;
}

export default function QueryTab({ tab }: QueryTabProps) {
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const updateQueryState = useTabStore((s) => s.updateQueryState);
  const setQueryMode = useTabStore((s) => s.setQueryMode);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const clearHistory = useQueryHistoryStore((s) => s.clearHistory);
  const historyEntries = useQueryHistoryStore((s) => s.entries);
  // Sprint 82 — resolve the active connection's dialect so the editor +
  // autocomplete namespace can tailor keywords / identifier quoting. A
  // missing connection (e.g. deleted mid-session) falls back to StandardSQL
  // via `databaseTypeToSqlDialect(undefined)`; document paradigm tabs keep
  // receiving the resolved dialect but ignore it inside `QueryEditor`.
  const connections = useConnectionStore((s) => s.connections);
  const sqlDialect = useMemo(() => {
    const conn = connections.find((c) => c.id === tab.connectionId);
    return databaseTypeToSqlDialect(conn?.db_type);
  }, [connections, tab.connectionId]);
  const schemaNamespace = useSqlAutocomplete(tab.connectionId, {
    dialect: sqlDialect,
  });
  const isDocument = tab.paradigm === "document";
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

    // Sprint 73 — document paradigm (MongoDB find / aggregate). Runs on a
    // separate code path from the SQL flow below: parses the editor body
    // as JSON, dispatches to the matching Tauri command, and funnels the
    // DocumentQueryResult into the existing queryState via a synthesized
    // QueryResult shape so the downstream QueryResultGrid can render rows
    // unchanged. Errors (invalid JSON, wrong pipeline type, backend
    // failures) land in `queryState: "error"` with a descriptive message.
    if (tab.paradigm === "document") {
      const docCtx = readDocumentContext(tab);
      if (!docCtx) {
        updateQueryState(tab.id, {
          status: "error",
          error:
            "Document query tabs require a target database and collection.",
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(sql);
      } catch (err) {
        updateQueryState(tab.id, {
          status: "error",
          error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      const queryId = `${tab.id}-${Date.now()}`;
      const startTime = Date.now();
      updateQueryState(tab.id, { status: "running", queryId });

      try {
        let docResult;
        if (tab.queryMode === "aggregate") {
          if (!isRecordArray(parsed)) {
            throw new Error("Pipeline must be a JSON array of stage objects.");
          }
          docResult = await aggregateDocuments(
            tab.connectionId,
            docCtx.database,
            docCtx.collection,
            parsed,
          );
        } else {
          // Default find path. Accept either an object (treated as the
          // filter) or the full FindBody shape if the user already wrapped
          // it.
          if (!isRecord(parsed)) {
            throw new Error(
              "Find body must be a JSON object (filter or FindBody).",
            );
          }
          const candidate = parsed as Record<string, unknown>;
          const looksLikeFindBody =
            "filter" in candidate ||
            "sort" in candidate ||
            "projection" in candidate ||
            "skip" in candidate ||
            "limit" in candidate;
          const body: FindBody = looksLikeFindBody
            ? (candidate as FindBody)
            : { filter: candidate };
          docResult = await findDocuments(
            tab.connectionId,
            docCtx.database,
            docCtx.collection,
            body,
          );
        }

        // Adapt DocumentQueryResult → QueryResult so the existing grid
        // can render the flattened rows without forking the result panel.
        const queryResult: import("@/types/query").QueryResult = {
          columns: docResult.columns,
          rows: docResult.rows,
          total_count: docResult.total_count,
          execution_time_ms: docResult.execution_time_ms,
          query_type: "select",
        };

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
                        status: "completed" as const,
                        result: queryResult,
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
    // The original Sprint 25 callback intentionally excluded
    // addHistoryEntry/updateQueryState from the dependency list so stale
    // closure issues don't fire on every store subscription. Sprint 73
    // reuses that contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab.id,
    tab.sql,
    tab.queryState.status,
    tab.connectionId,
    tab.paradigm,
    tab.queryMode,
    tab.database,
    tab.collection,
  ]);
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

  // Format SQL event listener (Cmd+I) — supports selection-only formatting.
  // Skipped on document paradigm tabs; JSON bodies should not be run through
  // the SQL formatter.
  useEffect(() => {
    if (tab.paradigm === "document") return;
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
  }, [tab.id, tab.sql, tab.paradigm, updateQuerySql]);

  // Uglify SQL event listener (Cmd+Shift+I). Also skipped for document tabs.
  useEffect(() => {
    if (tab.paradigm === "document") return;
    const handler = () => {
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
      if (!tab.sql.trim()) return;
      const uglified = uglifySql(tab.sql);
      updateQuerySql(tab.id, uglified);
    };
    window.addEventListener("uglify-sql", handler);
    return () => window.removeEventListener("uglify-sql", handler);
  }, [tab.id, tab.sql, tab.paradigm, updateQuerySql]);

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
            <span className="text-3xs text-muted-foreground">
              {"\u2318\u23CE"}
            </span>
          </Button>
        )}
        {!isDocument && (
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
        )}
        {isDocument && (
          <ToggleGroup
            type="single"
            value={tab.queryMode}
            onValueChange={(value) => {
              if (value === "find" || value === "aggregate") {
                setQueryMode(tab.id, value as QueryMode);
              }
            }}
            aria-label="Mongo query mode"
            className="ml-1"
          >
            <ToggleGroupItem value="find" aria-label="Find mode">
              Find
            </ToggleGroupItem>
            <ToggleGroupItem value="aggregate" aria-label="Aggregate mode">
              Aggregate
            </ToggleGroupItem>
          </ToggleGroup>
        )}
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
          paradigm={tab.paradigm}
          queryMode={tab.queryMode}
          sqlDialect={sqlDialect}
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
            <ul className="max-h-40 overflow-y-auto">
              {historyEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="group flex items-center gap-2 border-t border-border px-3 py-1 hover:bg-muted"
                  onDoubleClick={() => updateQuerySql(tab.id, entry.sql)}
                  title="Double-click to load into editor"
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background ${
                      entry.status === "success"
                        ? "bg-success"
                        : "bg-destructive"
                    }`}
                    title={entry.status}
                  />
                  <SqlSyntax
                    sql={entry.sql}
                    className="min-w-0 flex-1 select-text cursor-text truncate text-xs"
                  />
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {entry.duration}ms
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                    onClick={() => updateQuerySql(tab.id, entry.sql)}
                    aria-label={`Load query into editor: ${entry.sql}`}
                    title="Load into editor"
                  >
                    <CornerDownLeft />
                  </Button>
                </li>
              ))}
            </ul>
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
