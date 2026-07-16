import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@components/ui/dialog";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { dispatchLocalIntent } from "@lib/quickOpenIntent";
import { logger } from "@lib/logger";
import {
  pgSearchValues,
  cancelQuery,
  type ValueSearchResult,
} from "@lib/tauri";

/**
 * Issue #1525 — read-only cross-table value search dialog (PostgreSQL).
 *
 * Reuses the QuickOpen entry-point pattern verbatim: a Dialog opened by a
 * `pg-value-search` window CustomEvent (dispatched from Cmd/Ctrl+Shift+P),
 * with no new toolbar button or workspace panel. The dialog self-gates to the
 * current window's connection — only a connected PostgreSQL connection can
 * run a search; anything else renders a "PostgreSQL only" note.
 *
 * A match click reuses the QuickOpen `navigate-table` intent to open the
 * matched table in this window.
 */
export default function PgValueSearch() {
  const { t } = useTranslation("shared");
  const [isOpen, setIsOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ValueSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The in-flight cancel-token id, so the Cancel button can abort the scan.
  const queryIdRef = useRef<string | null>(null);

  const connectionId = useCurrentWindowConnectionId();
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const schemasByConn = useSchemaStore((s) => s.schemas);

  // Resolve the current window's PostgreSQL connection + its active database.
  const conn = connectionId
    ? connections.find((c) => c.id === connectionId)
    : undefined;
  const status = connectionId ? activeStatuses[connectionId] : undefined;
  const activeDb = status?.type === "connected" ? status.activeDb : undefined;
  const isPg = conn?.dbType === "postgresql" && !!activeDb;

  // User schemas of the active db (system schemas are already excluded by the
  // backend `list_schemas` query, so the store only holds user schemas).
  const schemaOptions = useMemo(() => {
    if (!connectionId || !activeDb) return [] as string[];
    return (schemasByConn[connectionId]?.[activeDb] ?? []).map((s) => s.name);
  }, [schemasByConn, connectionId, activeDb]);

  useEffect(() => {
    const handler = () => {
      setTerm("");
      setResult(null);
      setError(null);
      setRunning(false);
      queryIdRef.current = null;
      setIsOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("pg-value-search", handler);
    return () => window.removeEventListener("pg-value-search", handler);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    setTerm("");
    setResult(null);
    setError(null);
  };

  const handleRun = async () => {
    if (!isPg || !connectionId || !activeDb) return;
    const trimmed = term.trim();
    if (!trimmed || running) return;

    const queryId = crypto.randomUUID();
    queryIdRef.current = queryId;
    // Global scope: every user schema of the active db. The backend caps the
    // scan (row cap + per-table LIMIT + cancel); narrowing to one schema is a
    // deferred refinement.
    const schemas = schemaOptions;
    if (schemas.length === 0) return;

    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await pgSearchValues(
        connectionId,
        schemas,
        trimmed,
        queryId,
        activeDb,
      );
      // Ignore a stale response if the user launched another search meanwhile.
      if (queryIdRef.current === queryId) setResult(r);
    } catch (e) {
      if (queryIdRef.current === queryId) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (queryIdRef.current === queryId) setRunning(false);
    }
  };

  const handleCancel = () => {
    const queryId = queryIdRef.current;
    if (!queryId) return;
    queryIdRef.current = null;
    setRunning(false);
    void cancelQuery(queryId).catch((e) => {
      logger.warn(
        "[pg-value-search] cancel failed:",
        e instanceof Error ? e.message : e,
      );
    });
  };

  const handleSelectMatch = (matchSchema: string, table: string) => {
    if (!connectionId) return;
    dispatchLocalIntent({
      kind: "table",
      connectionId,
      schema: matchSchema,
      table,
    });
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void handleRun();
    }
  };

  const matches = result?.matches ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="w-full max-w-lg rounded-lg border border-border bg-background p-0 top-[20vh] translate-y-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("valueSearch.title")}</DialogTitle>
          <DialogDescription>{t("valueSearch.description")}</DialogDescription>
        </DialogHeader>

        {/* Search input row */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            placeholder={t("valueSearch.placeholder")}
            value={term}
            disabled={!isPg}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {running ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={handleCancel}
            >
              {t("valueSearch.cancel")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={!isPg || term.trim().length === 0}
              onClick={() => void handleRun()}
            >
              {t("valueSearch.run")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("valueSearch.closeAria")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleClose}
          >
            <X />
          </Button>
        </div>

        {/* Results / status */}
        <div className="max-h-80 overflow-y-auto" role="listbox">
          {!isPg ? (
            <div
              role="status"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {conn ? t("valueSearch.pgOnly") : t("valueSearch.noConnection")}
            </div>
          ) : running ? (
            <div
              role="status"
              aria-live="polite"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {t("valueSearch.running")}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="px-3 py-6 text-center text-sm text-destructive"
            >
              {error}
            </div>
          ) : result && matches.length === 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {t("valueSearch.noResults")}
            </div>
          ) : (
            <>
              {result && matches.length > 0 && (
                <div
                  role="status"
                  aria-live="polite"
                  className="px-3 pt-2 text-xs text-muted-foreground"
                >
                  {t("valueSearch.resultCount", { count: matches.length })}
                  {result.truncated ? ` · ${t("valueSearch.truncated")}` : ""}
                </div>
              )}
              {matches.map((m, index) => (
                <Button
                  key={`${m.schema}-${m.table}-${m.column}-${index}`}
                  role="option"
                  aria-selected={false}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 px-3 py-1.5 text-sm rounded-none h-auto"
                  onClick={() => handleSelectMatch(m.schema, m.table)}
                >
                  <Table2
                    size={13}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="text-foreground">
                    {m.schema}.{m.table}
                  </span>
                  <span className="text-muted-foreground">· {m.column}</span>
                  <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">
                    {m.value}
                  </span>
                </Button>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
