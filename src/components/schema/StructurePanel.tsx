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
  database: string;
  table: string;
  schema: string;
  /**
   * Paradigm-aware tab labels and empty-state copy. Defaults to `rdb`
   * (Columns/Constraints/...); pass `document` for Mongo
   * (Fields/Add Field/...).
   */
  paradigm?: Paradigm;
}

type SubTab = "columns" | "indexes" | "constraints";

export default function StructurePanel({
  connectionId,
  database,
  table,
  schema,
  paradigm,
}: StructurePanelProps) {
  const vocab = getParadigmVocabulary(paradigm);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("columns");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-tab "has the first fetch settled" gate. Without this, an editor
  // with an empty array would briefly paint a misleading "No columns
  // found" between mount and the first fetch resolving.
  const [hasFetchedColumns, setHasFetchedColumns] = useState(false);
  const [hasFetchedIndexes, setHasFetchedIndexes] = useState(false);
  const [hasFetchedConstraints, setHasFetchedConstraints] = useState(false);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const getTableIndexes = useSchemaStore((s) => s.getTableIndexes);
  const getTableConstraints = useSchemaStore((s) => s.getTableConstraints);
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
      } else {
        const cons = await getTableConstraints(
          connectionId,
          database,
          table,
          schema,
        );
        if (fetchIdRef.current !== fetchId) return;
        setConstraints(cons);
        setHasFetchedConstraints(true);
      }
    } catch (e) {
      if (fetchIdRef.current !== fetchId) return;
      setError(String(e));
      // Mark the tab as fetched even on failure so a subsequent retry
      // that succeeds with an empty list can reach the empty-state copy.
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
    database,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
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
    </div>
  );
}
