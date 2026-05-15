import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { listMongoIndexes } from "@lib/tauri";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { IndexInfo } from "@/types/schema";

import { CreateMongoIndexDialog } from "./CreateMongoIndexDialog";
import { DropMongoIndexDialog } from "./DropMongoIndexDialog";

export interface MongoIndexesPanelProps {
  connectionId: string;
  database: string;
  collection: string;
}

/**
 * MongoDB indexes panel — RO list + create + drop. `+ Index` opens the
 * full-option create dialog; per-row trash opens the typing-confirm
 * drop dialog. The `_id_` row's trash button is rendered but disabled
 * with `aria-disabled="true"` and a tooltip — backend rejects the same
 * drop at the Tauri layer (defence in depth).
 *
 * The `useDelayedFlag(loading, 1000)` gate matches the RDB
 * `StructurePanel` so sub-second reads never flash busy state.
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
  const [createOpen, setCreateOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Bump this to force the fetch effect to re-run after a successful
  // create / drop. Using a counter rather than the indexes list itself
  // keeps the effect dependency array stable.
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

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
  }, [connectionId, database, collection, refreshNonce]);

  const busy = useDelayedFlag(loading, 1000);

  return (
    <TooltipProvider>
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
          <div className="flex items-center gap-2">
            {busy && (
              <span
                className="flex items-center gap-1 text-3xs"
                data-testid="mongo-indexes-loading"
              >
                <Loader2 className="animate-spin" size={10} aria-hidden />
                Loading…
              </span>
            )}
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              data-testid="mongo-indexes-create"
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-3xs font-medium text-foreground hover:bg-muted"
            >
              <Plus className="size-3" aria-hidden /> Index
            </button>
          </div>
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
                <th className="px-3 py-1 font-medium w-10" />
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => {
                const isPrimary = idx.is_primary || idx.name === "_id_";
                const dropTestid = `mongo-index-drop-${idx.name}`;
                return (
                  <tr
                    key={idx.name}
                    className="border-b border-border last:border-none"
                  >
                    <td className="px-3 py-1">
                      <span className="font-mono">{idx.name}</span>
                      {isPrimary && (
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
                    <td className="px-3 py-1 text-right">
                      {isPrimary ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-disabled="true"
                              aria-label={`Drop ${idx.name}`}
                              data-testid={dropTestid}
                              onClick={(e) => e.preventDefault()}
                              className="cursor-not-allowed rounded p-1 text-muted-foreground/40"
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            The _id_ index cannot be dropped
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Drop ${idx.name}`}
                          data-testid={dropTestid}
                          onClick={() => setDropTarget(idx.name)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {createOpen && (
          <CreateMongoIndexDialog
            connectionId={connectionId}
            database={database}
            collection={collection}
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              refresh();
            }}
          />
        )}

        {dropTarget !== null && (
          <DropMongoIndexDialog
            connectionId={connectionId}
            database={database}
            collection={collection}
            indexName={dropTarget}
            open={dropTarget !== null}
            onClose={() => setDropTarget(null)}
            onDropped={() => {
              refresh();
            }}
          />
        )}
      </section>
    </TooltipProvider>
  );
}
