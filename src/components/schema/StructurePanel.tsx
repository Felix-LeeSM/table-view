import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useSchemaStore } from "@stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "@/types/schema";
import ColumnsEditor from "@components/structure/ColumnsEditor";
import IndexesEditor from "@components/structure/IndexesEditor";
import ConstraintsEditor from "@components/structure/ConstraintsEditor";
import { Tabs, TabsList, TabsTrigger } from "@components/ui/tabs";

interface StructurePanelProps {
  connectionId: string;
  table: string;
  schema: string;
}

type SubTab = "columns" | "indexes" | "constraints";

export default function StructurePanel({
  connectionId,
  table,
  schema,
}: StructurePanelProps) {
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getTableColumns(connectionId, table, schema);
        setColumns(cols);
        setHasFetchedColumns(true);
      } else if (activeSubTab === "indexes") {
        const idx = await getTableIndexes(connectionId, table, schema);
        setIndexes(idx);
        setHasFetchedIndexes(true);
      } else {
        const cons = await getTableConstraints(connectionId, table, schema);
        setConstraints(cons);
        setHasFetchedConstraints(true);
      }
    } catch (e) {
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
    setLoading(false);
  }, [
    connectionId,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
  ]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-structure", handler);
    return () => window.removeEventListener("refresh-structure", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "columns", label: "Columns" },
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
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
