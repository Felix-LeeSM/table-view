import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { listMongoIndexes } from "@lib/tauri";
import type { IndexInfo } from "@/types/schema";

export interface MongoIndexesPanelProps {
  connectionId: string;
  database: string;
  collection: string;
}

/**
 * Read-only list of MongoDB indexes for the given `(connectionId,
 * database, collection)` triplet. The `useDelayedFlag(loading, 1000)`
 * gate matches the RDB `StructurePanel` so sub-second reads never paint
 * a flash of busy state.
 */
export function MongoIndexesPanel({
  connectionId,
  database,
  collection,
}: MongoIndexesPanelProps) {
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The placeholder branch in `MainArea` already blocks this code path
    // when the tab lacks `database` / `collection`, but we guard again
    // so unit-mounted panels (tests, hot-reload) don't dispatch an
    // invalid IPC.
    if (database === "" || collection === "") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMongoIndexes(connectionId, database, collection)
      .then((rows) => {
        if (cancelled) return;
        setIndexes(rows);
        setHasFetched(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setHasFetched(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, database, collection]);

  const busy = useDelayedFlag(loading, 1000);

  return (
    <section
      aria-label="Mongo indexes panel"
      data-testid="mongo-indexes-panel"
      aria-busy={busy || undefined}
      className="flex flex-col gap-2"
    >
      <header className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>
          Indexes — {database}.{collection}
        </span>
        {busy && (
          <span
            className="flex items-center gap-1 text-3xs"
            data-testid="mongo-indexes-loading"
          >
            <Loader2 className="animate-spin" size={10} aria-hidden />
            Loading…
          </span>
        )}
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="mongo-indexes-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && error === null && hasFetched && indexes.length === 0 && (
        <div
          role="status"
          data-testid="mongo-indexes-empty"
          className="px-3 py-2 text-xs italic text-muted-foreground"
        >
          No indexes on this collection.
        </div>
      )}

      {indexes.length > 0 && (
        <table
          aria-label="Collection indexes"
          data-testid="mongo-indexes-list"
          className="w-full border-collapse text-xs"
        >
          <thead>
            <tr className="border-b border-border bg-secondary text-left text-muted-foreground">
              <th className="px-3 py-1 font-medium">Name</th>
              <th className="px-3 py-1 font-medium">Fields</th>
              <th className="px-3 py-1 font-medium">Type</th>
              <th className="px-3 py-1 font-medium">Unique</th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((idx) => (
              <tr
                key={idx.name}
                className="border-b border-border last:border-none"
              >
                <td className="px-3 py-1">
                  <span className="font-mono">{idx.name}</span>
                  {idx.is_primary && (
                    <span className="ml-2 rounded bg-primary/10 px-1 text-3xs uppercase tracking-wider text-primary">
                      primary
                    </span>
                  )}
                </td>
                <td className="px-3 py-1 font-mono">
                  {idx.columns.join(", ")}
                </td>
                <td className="px-3 py-1">{idx.index_type}</td>
                <td className="px-3 py-1">{idx.is_unique ? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
