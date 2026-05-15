// Sprint 337 (2026-05-15) — U2 live wire. RDB EXPLAIN (ANALYZE, FORMAT
// JSON) and Mongo runCommand({explain: …}) wrapped behind a single
// component. Plan is rendered as a pretty-printed JSON tree (raw shape).

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  explainMongoFind,
  explainRdbQuery,
  type ExplainMongoFindArgs,
} from "@/lib/api/explain";
import { safeStringifyCell } from "@/lib/jsonCell";

export interface ExplainViewerProps {
  connectionId: string;
  paradigm: "table" | "document";
  /** RDB only — the SQL to explain. */
  rdbSql?: string;
  /** Mongo only — `{database, collection, filter?, verbosity?}` */
  mongoSpec?: ExplainMongoFindArgs;
}

export function ExplainViewer({
  connectionId,
  paradigm,
  rdbSql,
  mongoSpec,
}: ExplainViewerProps) {
  const [plan, setPlan] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next =
        paradigm === "document"
          ? await explainMongoFind(
              connectionId,
              mongoSpec ?? {
                database: "",
                collection: "",
              },
            )
          : await explainRdbQuery(connectionId, rdbSql ?? "");
      setPlan(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, paradigm, rdbSql, mongoSpec]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      aria-label="Explain viewer"
      data-paradigm={paradigm}
      data-testid="explain-viewer"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Explain ({paradigm === "table" ? "PG" : "Mongo"})</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="explain-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          Refresh
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="explain-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && error === null && plan !== null && (
        <pre
          data-testid="explain-plan"
          className="max-h-96 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono text-xs leading-relaxed text-foreground"
        >
          {safeStringifyCell(plan, 2)}
        </pre>
      )}
    </section>
  );
}
