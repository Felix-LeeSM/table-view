import { useState, useCallback } from "react";
import { MongoIndexesPanel } from "./MongoIndexesPanel";
import { ValidatorPanel } from "./ValidatorPanel";

export type MongoStructureSubTab = "indexes" | "validator";

export interface MongoStructurePanelProps {
  connectionId: string;
  database: string;
  collection: string;
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

interface SubTabDef {
  key: MongoStructureSubTab;
  label: string;
}

const SUB_SUB_TABS: readonly SubTabDef[] = [
  { key: "indexes", label: "Indexes" },
  { key: "validator", label: "Validator" },
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
  active: activeProp,
  onActiveChange,
}: MongoStructurePanelProps) {
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

  const toggle = useCallback(() => {
    setActive(active === "indexes" ? "validator" : "indexes");
  }, [active, setActive]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label="Mongo structure view"
        data-testid="mongo-structure-subsubtab-bar"
        className="flex items-center border-b border-border bg-secondary"
      >
        {SUB_SUB_TABS.map((tab) => {
          const selected = active === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground"
              }`}
              onClick={() => setActive(tab.key)}
              onKeyDown={handleKeyDown}
              data-testid={`mongo-structure-subsubtab-${tab.key}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 flex-col overflow-auto">
        {active === "indexes" ? (
          <MongoIndexesPanel
            connectionId={connectionId}
            database={database}
            collection={collection}
          />
        ) : (
          <ValidatorPanel
            connectionId={connectionId}
            database={database}
            collection={collection}
          />
        )}
      </div>
    </div>
  );
}
