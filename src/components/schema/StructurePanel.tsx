import { useState, useEffect, useCallback, useRef } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TriggerInfo,
} from "@/types/schema";
import type { Paradigm } from "@/types/connection";
import { getParadigmVocabulary } from "@/lib/strings/paradigm-vocabulary";
import ColumnsEditor from "@components/structure/ColumnsEditor";
import IndexesEditor from "@components/structure/IndexesEditor";
import ConstraintsEditor from "@components/structure/ConstraintsEditor";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { cancelQuery } from "@lib/tauri";
import { Tabs, TabsList, TabsTrigger } from "@components/ui/tabs";

interface StructurePanelProps {
  connectionId: string;
  database: string;
  table: string;
  schema: string;
  /**
   * Paradigm-aware tab labels and empty-state copy. Defaults to `rdb`
   * (Columns/Constraints/...); pass `document` for Mongo
   * (Fields/Add Field/...).
   */
  paradigm?: Paradigm;
  /**
   * Sprint 272 — initial sub-tab to render on mount. `undefined` falls
   * back to "columns" (pre-Sprint-272 default). The Sidebar "View
   * Triggers" right-click affordance threads `"triggers"` here.
   */
  initialSubTab?: SubTab;
}

// Sprint 272 — `SubTab` enum extended with `"triggers"`. Existing
// `"columns" | "indexes" | "constraints"` consumers are byte-equivalent;
// the new value is opt-in via the right-click "View Triggers" path.
type SubTab = "columns" | "indexes" | "constraints" | "triggers";

export default function StructurePanel({
  connectionId,
  database,
  table,
  schema,
  paradigm,
  initialSubTab,
}: StructurePanelProps) {
  const vocab = getParadigmVocabulary(paradigm);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(
    initialSubTab ?? "columns",
  );
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-tab "has the first fetch settled" gate. Without this, an editor
  // with an empty array would briefly paint a misleading "No columns
  // found" between mount and the first fetch resolving.
  const [hasFetchedColumns, setHasFetchedColumns] = useState(false);
  const [hasFetchedIndexes, setHasFetchedIndexes] = useState(false);
  const [hasFetchedConstraints, setHasFetchedConstraints] = useState(false);
  // Sprint 272 — Triggers tab "has-fetched" gate. Mirrors the same gate
  // pattern as Columns / Indexes / Constraints to prevent a misleading
  // "No triggers" flash before the first fetch settles.
  const [hasFetchedTriggers, setHasFetchedTriggers] = useState(false);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const getTableIndexes = useSchemaStore((s) => s.getTableIndexes);
  const getTableConstraints = useSchemaStore((s) => s.getTableConstraints);
  const getTableTriggers = useSchemaStore((s) => s.getTableTriggers);
  // fetchId guards against stale resolves overwriting state after a
  // Cancel-then-retry. The in-flight `query_id` is plumbed through the
  // Tauri command so the Cancel button can drive `cancel_query`.
  const fetchIdRef = useRef(0);
  const queryIdRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getTableColumns(
          connectionId,
          database,
          table,
          schema,
        );
        if (fetchIdRef.current !== fetchId) return;
        setColumns(cols);
        setHasFetchedColumns(true);
      } else if (activeSubTab === "indexes") {
        const idx = await getTableIndexes(
          connectionId,
          database,
          table,
          schema,
        );
        if (fetchIdRef.current !== fetchId) return;
        setIndexes(idx);
        setHasFetchedIndexes(true);
      } else if (activeSubTab === "constraints") {
        const cons = await getTableConstraints(
          connectionId,
          database,
          table,
          schema,
        );
        if (fetchIdRef.current !== fetchId) return;
        setConstraints(cons);
        setHasFetchedConstraints(true);
      } else {
        // Sprint 272 — Triggers tab. Cache-first store action; second
        // call with identical `(connId, db, schema, table)` returns the
        // cached array without re-invoking the IPC.
        const trigs = await getTableTriggers(
          connectionId,
          database,
          table,
          schema,
        );
        if (fetchIdRef.current !== fetchId) return;
        setTriggers(trigs);
        setHasFetchedTriggers(true);
      }
    } catch (e) {
      if (fetchIdRef.current !== fetchId) return;
      setError(String(e));
      // Mark the tab as fetched even on failure so a subsequent retry
      // that succeeds with an empty list can reach the empty-state copy.
      if (activeSubTab === "columns") setHasFetchedColumns(true);
      else if (activeSubTab === "indexes") setHasFetchedIndexes(true);
      else if (activeSubTab === "constraints") setHasFetchedConstraints(true);
      else setHasFetchedTriggers(true);
    }
    if (fetchIdRef.current === fetchId) {
      setLoading(false);
      queryIdRef.current = null;
    }
  }, [
    connectionId,
    database,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
    getTableTriggers,
  ]);

  // Bump `fetchIdRef` so the in-flight resolve is treated as stale,
  // clear `loading` synchronously, and best-effort cancel the backend.
  const handleCancelStructureFetch = useCallback(() => {
    fetchIdRef.current++;
    setLoading(false);
    const queryId = queryIdRef.current;
    queryIdRef.current = null;
    if (queryId) {
      cancelQuery(queryId).catch(() => {
        // best-effort — see DocumentDataGrid.handleCancelRefetch
      });
    }
  }, []);

  // Threshold gate for the shared overlay — only paints after `loading`
  // has been continuously true for 1s.
  const overlayVisible = useDelayedFlag(loading, 1000);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-structure", handler);
    return () => window.removeEventListener("refresh-structure", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // `key` is the stable internal identifier; only `label` flows through
  // the paradigm dictionary. Indexes/Constraints stay paradigm-fixed —
  // no Mongo/kv equivalent in scope yet.
  const subTabs: { key: SubTab; label: string }[] = [
    { key: "columns", label: vocab.units },
    { key: "indexes", label: "Indexes" },
    { key: "constraints", label: "Constraints" },
    // Sprint 272 — read-only Triggers tab. Order is fixed (after
    // Constraints) per master spec § 2 and contract § In Scope.
    { key: "triggers", label: "Triggers" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <Tabs
        value={activeSubTab}
        onValueChange={(v) => setActiveSubTab(v as SubTab)}
      >
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-secondary gap-0">
          {subTabs.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="rounded-none px-4"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* The positioned wrapper anchors `AsyncProgressOverlay`'s
          `absolute inset-0`. Sub-second fetches never paint the overlay
          (see `useDelayedFlag`) so this region usually stays empty. */}
      {loading && (
        <div
          data-testid="structure-loading-region"
          className="relative flex items-center justify-center py-8"
        >
          <AsyncProgressOverlay
            visible={overlayVisible}
            onCancel={handleCancelStructureFetch}
            className="static py-8"
          />
        </div>
      )}

      {/* Editors live outside the tab bar. Each is gated on its
          `hasFetched*` flag so a slow first fetch can't briefly paint
          the "No X found" empty state with an empty array. */}
      {!loading &&
        !error &&
        activeSubTab === "columns" &&
        hasFetchedColumns && (
          <ColumnsEditor
            key={`${connectionId}-${table}-${schema}`}
            connectionId={connectionId}
            database={database}
            table={table}
            schema={schema}
            columns={columns}
            onRefresh={fetchData}
            paradigm={paradigm}
          />
        )}
      {!loading &&
        !error &&
        activeSubTab === "indexes" &&
        hasFetchedIndexes && (
          <IndexesEditor
            connectionId={connectionId}
            database={database}
            table={table}
            schema={schema}
            indexes={indexes}
            columns={columns}
            onColumnsChange={setColumns}
            onRefresh={fetchData}
          />
        )}
      {!loading &&
        !error &&
        activeSubTab === "constraints" &&
        hasFetchedConstraints && (
          <ConstraintsEditor
            connectionId={connectionId}
            database={database}
            table={table}
            schema={schema}
            constraints={constraints}
            columns={columns}
            onColumnsChange={setColumns}
            onRefresh={fetchData}
          />
        )}

      {/* Sprint 272 — read-only Triggers viewer. CREATE / DROP land in
          Sprint 273 / 274; this surface only displays existing triggers
          + their `pg_get_triggerdef` source. `hasFetchedTriggers` gate
          prevents an "No triggers" flash on first paint. */}
      {!loading &&
        !error &&
        activeSubTab === "triggers" &&
        hasFetchedTriggers && <TriggersList triggers={triggers} />}
    </div>
  );
}

interface TriggersListProps {
  triggers: TriggerInfo[];
}

/**
 * Sprint 272 — read-only viewer for the Triggers sub-tab. Renders one
 * card per trigger with structured metadata (timing / events / orientation
 * / function reference / WHEN clause) followed by the canonical
 * `pg_get_triggerdef` source in a monospace `<pre>` block. Empty state is
 * an italic placeholder (matches the `No constraints` / `No indexes`
 * pattern used by sibling editors).
 *
 * CREATE / DROP affordances are out of scope for Sprint 272 (see master
 * spec § 7 — they land in Sprint 273 / 274). The "Create Trigger…" /
 * "Drop Trigger…" buttons are intentionally absent from this surface;
 * the right-click Table context menu carries disabled placeholders.
 */
function TriggersList({ triggers }: TriggersListProps) {
  if (triggers.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm italic text-muted-foreground">
        No triggers
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3">
      <ul className="flex flex-col gap-3">
        {triggers.map((t) => (
          <li
            key={`${t.schema}.${t.table}.${t.name}`}
            className="rounded border border-border bg-card p-3"
            aria-label={`Trigger ${t.name}`}
          >
            <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-sm font-semibold text-foreground">
                {t.name}
              </span>
              <span className="text-2xs text-muted-foreground">
                {t.timing} {t.events.join(" OR ")} · FOR EACH {t.orientation}
              </span>
            </header>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-2xs">
              <dt className="text-muted-foreground">Function</dt>
              <dd className="font-mono text-foreground">
                {t.functionSchema}.{t.functionName}
                {t.arguments ? `(${t.arguments})` : "()"}
              </dd>
              {t.whenExpression && (
                <>
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="font-mono text-foreground">
                    {t.whenExpression}
                  </dd>
                </>
              )}
            </dl>
            <pre
              data-testid={`trigger-source-${t.name}`}
              className="mt-2 max-h-72 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-2xs text-foreground"
            >
              {t.definition}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
