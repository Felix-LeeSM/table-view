// The tab-local database selector for a Mongo query tab.
//
// The lock was reversed. The chip used to be a DataGrip-style display
// chip, and the sidebar right-click "New query here" was the single owner
// of a database change. The user explicitly asked to be able to change it
// from the toolbar ("you can't even pick a database"), so the chip is an
// interactive popover switcher. It keeps visual parity with the RDB
// `DbSwitcher`, but the target semantics are tab-local (it updates only
// `tab.database` and leaves `connection.activeDb` alone — Mongo has no
// equivalent of the RDB active sub-pool, so binding this to a global chip
// would have side effects on other tabs).

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import {
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import { ChevronDown, Database, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listDatabases } from "@/lib/api/listDatabases";
import { toast } from "@/lib/runtime/toast";
import type { DatabaseInfo } from "@/types/document";

export interface TabDbChipProps {
  tabId: string;
  /** Mongo database currently bound to the tab. Empty string renders the
   *  "(no database)" placeholder so the user always sees the affordance —
   *  it never self-hides like the legacy chip did, because hiding the
   *  control was the original "I can't select a database" complaint. */
  database: string;
  connectionId: string;
}

export default function TabDbChip({
  tabId,
  database,
  connectionId,
}: TabDbChipProps) {
  const { t } = useTranslation("query");
  const workspaceKey = useCurrentWorkspaceKey();
  const setQueryTabDatabase = useWorkspaceStore((s) => s.setQueryTabDatabase);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Invalidate the cached list when the connection changes so a stale
  // database list from a previous tab can't leak across connections.
  const lastFetchKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastFetchKeyRef.current !== connectionId) {
      setDatabases([]);
      setErrorMessage(null);
      setOpen(false);
      lastFetchKeyRef.current = null;
    }
  }, [connectionId]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await listDatabases(connectionId);
      setDatabases(result);
      lastFetchKeyRef.current = connectionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      toast.error(`Failed to list databases: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void fetchList();
    },
    [fetchList],
  );

  const handleSelect = useCallback(
    (dbName: string) => {
      if (!workspaceKey) return;
      if (dbName === database) {
        setOpen(false);
        return;
      }
      setQueryTabDatabase(workspaceKey.connId, workspaceKey.db, tabId, dbName);
      setOpen(false);
      toast.success(`Query tab is now targeting "${dbName}".`);
    },
    [workspaceKey, database, setQueryTabDatabase, tabId],
  );

  // Mongo db-contract α: the chip label reflects the *binding*, not a
  // CTA. Empty `database` means the tab has no collection-scope target
  // bound — admin commands (`db.runCommand`, `db.adminCommand`) can still
  // run; only collection commands require the user to pick one.
  // "(no database)" makes the absence visible without nagging the user to
  // select before every admin call.
  const label = database === "" ? t("tabDbChip.noDatabase") : database;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            database
              ? t("tabDbChip.currentDbAria", { database })
              : t("tabDbChip.noDbAria")
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent"
        >
          {loading ? (
            <Loader2
              size={12}
              className="shrink-0 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : (
            <Database
              size={12}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <span className="truncate">{label}</span>
          <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-56 p-1">
        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {t("tabDbChip.loadingDatabases")}
          </div>
        ) : errorMessage ? (
          <div
            role="alert"
            data-testid="tab-db-chip-error"
            className="rounded-sm bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          >
            {errorMessage}
          </div>
        ) : databases.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("tabDbChip.noDatabasesAvailable")}
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label={t("tabDbChip.availableDbsAria")}
            className="flex flex-col"
          >
            {databases.map((db, idx) => (
              <li key={db.name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={db.name === database}
                  data-active={db.name === database || undefined}
                  autoFocus={idx === 0}
                  onClick={() => handleSelect(db.name)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none data-[active]:font-medium"
                >
                  <Database
                    size={12}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate">{db.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
