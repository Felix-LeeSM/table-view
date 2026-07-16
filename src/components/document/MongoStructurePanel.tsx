import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MongoIndexesPanel } from "./MongoIndexesPanel";
import { ValidatorPanel } from "./ValidatorPanel";
import { CollectionStatsPanel } from "./CollectionStatsPanel";
import { type DatabaseType } from "@/types/connection";

export type MongoStructureSubTab = "indexes" | "validator" | "stats";

export interface MongoStructurePanelProps {
  connectionId: string;
  database: string;
  collection: string;
  dbType: DatabaseType;
  /**
   * When provided, the Indexes/Validator sub-sub-tab selection is
   * controlled by the caller. The owner holds the state so the inner
   * selection survives an outer Records ↔ Structure remount inside the
   * same tab. When omitted the panel falls back to a local-state
   * uncontrolled mode (used by unit tests of the panel in isolation).
   */
  active?: MongoStructureSubTab;
  onActiveChange?: (next: MongoStructureSubTab) => void;
}

const SUB_SUB_TABS: readonly MongoStructureSubTab[] = [
  "indexes",
  "validator",
  // #1054 — U3 collection stats. CollectionStatsPanel was authored + tested
  // (Sprint 338) but never mounted; this is its collection-context home
  // (it needs (database, collection), so the connection-level Operations
  // flyout is the wrong entry point — ui-parity §3 exception).
  "stats",
] as const;

/**
 * Mongo collection Structure pane. Owns (or accepts via controlled
 * props) the Indexes / Validator sub-sub-tab selection. Persistence
 * across app restarts is intentionally out of scope.
 *
 * The two children are mounted conditionally rather than always-rendered-
 * with-hidden-style so the existing `ValidatorPanel` keeps its current
 * read-on-mount semantics — the validator IPC fires only when the user
 * activates the Validator sub-sub-tab, byte-equivalent to its prior
 * placement at the collection-tab root.
 */
export function MongoStructurePanel({
  connectionId,
  database,
  collection,
  dbType,
  active: activeProp,
  onActiveChange,
}: MongoStructurePanelProps) {
  const { t } = useTranslation("document");
  const [activeLocal, setActiveLocal] =
    useState<MongoStructureSubTab>("indexes");
  const active = activeProp ?? activeLocal;
  const setActive = useCallback(
    (next: MongoStructureSubTab) => {
      if (onActiveChange) {
        onActiveChange(next);
      } else {
        setActiveLocal(next);
      }
    },
    [onActiveChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const dir =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (dir === 0) return;
      event.preventDefault();
      const i = SUB_SUB_TABS.indexOf(active);
      const len = SUB_SUB_TABS.length;
      // Modulo keeps the index in range; the guard only satisfies
      // noUncheckedIndexedAccess (next is never undefined here).
      const next = SUB_SUB_TABS[(i + dir + len) % len];
      if (next) setActive(next);
    },
    [active, setActive],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label={t("structurePanel.ariaLabel")}
        data-testid="mongo-structure-subsubtab-bar"
        className="flex items-center border-b border-border bg-secondary"
      >
        {SUB_SUB_TABS.map((key) => {
          const selected = active === key;
          const label =
            key === "indexes"
              ? t("structurePanel.tabIndexes")
              : key === "validator"
                ? t("structurePanel.tabValidator")
                : t("structurePanel.tabStats");
          return (
            <button
              key={key}
              role="tab"
              id={`tab-mongo-structure-${key}`}
              aria-controls={`tabpanel-mongo-structure-${key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => setActive(key)}
              onKeyDown={handleKeyDown}
              data-testid={`mongo-structure-subsubtab-${key}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`tabpanel-mongo-structure-${active}`}
        aria-labelledby={`tab-mongo-structure-${active}`}
        tabIndex={0}
        className="flex flex-1 flex-col overflow-auto"
      >
        {active === "indexes" ? (
          <MongoIndexesPanel
            connectionId={connectionId}
            database={database}
            collection={collection}
          />
        ) : active === "validator" ? (
          <ValidatorPanel
            connectionId={connectionId}
            database={database}
            collection={collection}
          />
        ) : (
          <CollectionStatsPanel
            connectionId={connectionId}
            database={database}
            collection={collection}
            dbType={dbType}
          />
        )}
      </div>
    </div>
  );
}
