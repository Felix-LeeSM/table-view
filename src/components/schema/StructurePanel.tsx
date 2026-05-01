import { useState, useEffect, useCallback, useRef } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "@/types/schema";
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
  table: string;
  schema: string;
  /**
   * Sprint 179 — paradigm-aware tab labels and empty-state copy. Defaults
   * to `"rdb"` so existing RDB callers see the legacy English vocabulary
   * unchanged. Mongo callers can pass `"document"` to render
   * "Fields" / "Add Field" / "No fields found".
   */
  paradigm?: Paradigm;
}

type SubTab = "columns" | "indexes" | "constraints";

export default function StructurePanel({
  connectionId,
  table,
  schema,
  paradigm,
}: StructurePanelProps) {
  // Sprint 179 (AC-179-04) — `getParadigmVocabulary` enforces the
  // `undefined → rdb` fallback in one place; component just looks up.
  const vocab = getParadigmVocabulary(paradigm);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("columns");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // sprint-176 (AC-176-03 / RISK-035) — first-render flash gate. Each sub-tab
  // tracks whether its initial fetch has settled. Until that flips true the
  // editor branch (which renders "No columns/indexes/constraints found"
  // when its array is empty) is suppressed, so the user never sees a fake
  // empty-state during the time window between mount and the first fetch
  // resolving. The flag is per-tab so flipping tabs gates the new tab's
  // first fetch as well, not just the overall first fetch.
  const [hasFetchedColumns, setHasFetchedColumns] = useState(false);
  const [hasFetchedIndexes, setHasFetchedIndexes] = useState(false);
  const [hasFetchedConstraints, setHasFetchedConstraints] = useState(false);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const getTableIndexes = useSchemaStore((s) => s.getTableIndexes);
  const getTableConstraints = useSchemaStore((s) => s.getTableConstraints);
  // Sprint 180 — fetchId guard so a Cancel-then-retry can drop the
  // stale resolve without overwriting the new state. Schema fetches
  // don't have a tab-store-backed query id (unlike `executeQuery`),
  // but the in-flight `query_id` is plumbed through the Tauri command
  // so the Cancel button can route to `cancel_query` at the backend.
  const fetchIdRef = useRef(0);
  const queryIdRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getTableColumns(connectionId, table, schema);
        if (fetchIdRef.current !== fetchId) return;
        setColumns(cols);
        setHasFetchedColumns(true);
      } else if (activeSubTab === "indexes") {
        const idx = await getTableIndexes(connectionId, table, schema);
        if (fetchIdRef.current !== fetchId) return;
        setIndexes(idx);
        setHasFetchedIndexes(true);
      } else {
        const cons = await getTableConstraints(connectionId, table, schema);
        if (fetchIdRef.current !== fetchId) return;
        setConstraints(cons);
        setHasFetchedConstraints(true);
      }
    } catch (e) {
      if (fetchIdRef.current !== fetchId) return;
      setError(String(e));
      // Sprint-176 — even on rejection mark the tab as fetched. The error
      // banner takes over the visible space and the editor branch stays
      // hidden because the gate below also checks `!error`. We still flip
      // hasFetched so a subsequent retry that succeeds with an empty list
      // can reach the empty-state copy.
      if (activeSubTab === "columns") setHasFetchedColumns(true);
      else if (activeSubTab === "indexes") setHasFetchedIndexes(true);
      else setHasFetchedConstraints(true);
    }
    if (fetchIdRef.current === fetchId) {
      setLoading(false);
      queryIdRef.current = null;
    }
  }, [
    connectionId,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
  ]);

  // Sprint 180 (AC-180-02 / AC-180-05) — Cancel handler for the schema
  // structure fetch. Bumps `fetchIdRef` so the in-flight resolve is
  // treated as stale, clears `loading` synchronously, and best-effort
  // cancels the backend driver handle.
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

  // Sprint 180 (AC-180-01) — threshold gate for the shared overlay.
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

  // Sprint 179 — `key: "columns"` stays a stable identifier (it backs the
  // `activeSubTab` state and never appears in the DOM as user-visible
  // text); only the `label` value flows through the paradigm dictionary.
  // "Indexes" and "Constraints" stay paradigm-fixed for now: structural
  // concepts that have no Mongo / kv equivalent in the current scope.
  const subTabs: { key: SubTab; label: string }[] = [
    { key: "columns", label: vocab.units },
    { key: "indexes", label: "Indexes" },
    { key: "constraints", label: "Constraints" },
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

      {/* Loading — Sprint 180. Wrapped in a positioned container so the
          shared `AsyncProgressOverlay` (which uses `absolute inset-0`)
          has a relative ancestor to anchor against. The overlay only
          paints after `loading` has been continuously true for 1s
          (`useDelayedFlag`); for sub-second fetches this region stays
          empty and the user proceeds straight to the editor branch
          when the fetch resolves. */}
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

      {/* Editors — outside the tab bar.
          Sprint-176 (AC-176-03 / RISK-035): each editor is gated behind its
          own `hasFetched*` flag so the empty-state copy ("No columns
          found" / "No indexes found" / "No constraints found") cannot
          paint before the first fetch on that tab settles. Without this
          gate a slow-resolving fetch would briefly render the editor with
          an empty array and the user would see a misleading "no data"
          message before the actual data arrives. */}
      {!loading &&
        !error &&
        activeSubTab === "columns" &&
        hasFetchedColumns && (
          <ColumnsEditor
            key={`${connectionId}-${table}-${schema}`}
            connectionId={connectionId}
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
            table={table}
            schema={schema}
            constraints={constraints}
            columns={columns}
            onColumnsChange={setColumns}
            onRefresh={fetchData}
          />
        )}
    </div>
  );
}
