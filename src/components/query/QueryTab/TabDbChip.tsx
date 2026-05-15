// Mongo query tab의 tab-local database selector.
//
// 2026-05-15 — Sprint 329 lock 뒤집힘. 이전엔 DataGrip-style display chip
// 으로, database 변경은 사이드바 우클릭 "New query here" 의 단일 owner
// 였다. 사용자가 직접 toolbar 안에서 변경 가능해야 한다고 명시 요구
// ("database 선택도 못 한다 친구야") 해서 chip 을 interactive popover
// switcher 로 교체한다. RDB 의 `DbSwitcher` 와 시각적 패리티를 맞추되,
// 대상 시맨틱은 tab-local (`tab.database` 만 갱신; `connection.activeDb`
// 는 건드리지 않는다 — Mongo 는 RDB 의 active sub-pool 개념이 없어서
// 전역 chip 으로 바인딩하면 다른 탭에 부수효과가 생긴다).

import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, Database, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { listDatabases } from "@/lib/api/listDatabases";
import { toast } from "@/lib/toast";
import {
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import type { DatabaseInfo } from "@/types/document";

export interface TabDbChipProps {
  tabId: string;
  /** Mongo database currently bound to the tab. Empty string renders the
   *  "(none)" placeholder so the user always sees the affordance — never
   *  self-hides like the legacy Sprint 329 chip did, because hiding the
   *  control was the original "I can't select a database" complaint. */
  database: string;
  connectionId: string;
}

export default function TabDbChip({
  tabId,
  database,
  connectionId,
}: TabDbChipProps) {
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

  const label = database === "" ? "(select database)" : database;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            database
              ? `Current database: ${database}. Click to change.`
              : "No database selected. Click to choose one."
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
            Loading databases…
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
            No databases available.
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label="Available databases"
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
