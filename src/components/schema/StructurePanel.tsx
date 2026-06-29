import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
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
import {
  StructureShell,
  StructureActionBar,
  StructureEmpty,
} from "@components/structure/shared/structureUI";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { cancelQuery } from "@lib/tauri";
import { Tabs, TabsList, TabsTrigger } from "@components/ui/tabs";
import { Button } from "@components/ui/button";
import CreateTriggerDialog from "./CreateTriggerDialog";
import DropTriggerDialog from "./DropTriggerDialog";
import { useConnectionStore } from "@stores/connectionStore";

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
   * back to "columns" (pre-Sprint-272 default). Sprint 275 — the
   * Sidebar "View Triggers" entry was retired (sidebar trigger surface
   * removed); the prop remains so future external entry points can
   * deep-link to the Triggers sub-tab.
   */
  initialSubTab?: SubTab;
}

// Sprint 272 — `SubTab` enum extended with `"triggers"`. Existing
// `"columns" | "indexes" | "constraints"` consumers are byte-equivalent.
// Sprint 275 — `"triggers"` is now the single entry point for trigger
// CRUD (sidebar Triggers child group retired).
type SubTab = "columns" | "indexes" | "constraints" | "triggers";

export default function StructurePanel({
  connectionId,
  database,
  table,
  schema,
  paradigm,
  initialSubTab,
}: StructurePanelProps) {
  const { t } = useTranslation("schema");
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
  // Sprint 275 — trigger CRUD now lives entirely on this surface (the
  // SchemaTree sidebar Triggers child group was retired). Local dialog
  // slots: `createTriggerDialog` opens the +Create Trigger modal,
  // `dropTriggerDialog` opens the per-trigger trash modal. Both `null`
  // when closed. The success path closes the slot AND calls
  // `refreshTableTriggers` to invalidate the schemaStore cache so the
  // list refreshes without a tree-wide reload.
  const [createTriggerDialog, setCreateTriggerDialog] =
    useState<boolean>(false);
  const [dropTriggerDialog, setDropTriggerDialog] = useState<{
    triggerName: string;
  } | null>(null);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const getTableIndexes = useSchemaStore((s) => s.getTableIndexes);
  const getTableConstraints = useSchemaStore((s) => s.getTableConstraints);
  const getTableTriggers = useSchemaStore((s) => s.getTableTriggers);
  const refreshTableTriggers = useSchemaStore((s) => s.refreshTableTriggers);
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.dbType,
  );
  const supportsStructuredTriggerCrud =
    dbType !== "mysql" && dbType !== "mariadb";
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
    { key: "indexes", label: t("indexesTab") },
    { key: "constraints", label: t("constraintsTab") },
    // Sprint 272 — read-only Triggers tab. Order is fixed (after
    // Constraints) per master spec § 2 and contract § In Scope.
    { key: "triggers", label: t("triggersTab") },
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

      {/* Sprint 272 — Triggers viewer. Sprint 275 — full CRUD now lives
          on this surface (sidebar Triggers child group retired): the
          `+ Create Trigger` button opens `CreateTriggerDialog`; each
          trigger row carries a per-row trash icon that opens
          `DropTriggerDialog`. The `hasFetchedTriggers` gate prevents an
          "No triggers" flash on first paint. */}
      {!loading &&
        !error &&
        activeSubTab === "triggers" &&
        hasFetchedTriggers && (
          <TriggersList
            triggers={triggers}
            onCreate={() => setCreateTriggerDialog(true)}
            onDrop={(triggerName) => setDropTriggerDialog({ triggerName })}
            supportsStructuredCrud={supportsStructuredTriggerCrud}
          />
        )}

      {/* Sprint 275 — CreateTriggerDialog mount. Moved here from
          SchemaTree (Sprint 273) so the trigger CRUD surface is
          consolidated. `onRefresh` invalidates the schemaStore cache for
          `(connId, db, schema, table)` so the new trigger appears in
          the list without a sidebar/tree reload. */}
      {createTriggerDialog && (
        <CreateTriggerDialog
          connectionId={connectionId}
          database={database}
          schemaName={schema}
          tableName={table}
          open
          onClose={() => setCreateTriggerDialog(false)}
          onRefresh={async () => {
            await refreshTableTriggers(connectionId, database, table, schema);
            // Pull fresh list into local state so the row count + cards
            // update immediately; the cache invalidate above ensures the
            // re-render is consistent with the store.
            await fetchData();
          }}
        />
      )}

      {/* Sprint 275 — DropTriggerDialog mount. Same wiring as Create;
          carries the per-row trigger name into the typing-confirm
          input. */}
      {dropTriggerDialog && (
        <DropTriggerDialog
          connectionId={connectionId}
          database={database}
          schemaName={schema}
          tableName={table}
          triggerName={dropTriggerDialog.triggerName}
          open
          onClose={() => setDropTriggerDialog(null)}
          onRefresh={async () => {
            await refreshTableTriggers(connectionId, database, table, schema);
            await fetchData();
          }}
        />
      )}
    </div>
  );
}

interface TriggersListProps {
  triggers: TriggerInfo[];
  onCreate: () => void;
  onDrop: (triggerName: string) => void;
  supportsStructuredCrud: boolean;
}

/**
 * Sprint 272 — viewer for the Triggers sub-tab. Sprint 275 — now the
 * single entry point for trigger CRUD (sidebar Triggers child group was
 * retired). Surfaces:
 *   - Header toolbar with `+ Create Trigger` button (opens
 *     `CreateTriggerDialog` via `onCreate`).
 *   - One card per trigger with structured metadata + the canonical
 *     `pg_get_triggerdef` source in a monospace `<pre>` block. Per-row
 *     trash icon opens `DropTriggerDialog` via `onDrop(triggerName)`.
 *   - Empty state is an italic placeholder; DBMSs with structured
 *     trigger CRUD support also get the Create button on this tab.
 */
function TriggersList({
  triggers,
  onCreate,
  onDrop,
  supportsStructuredCrud,
}: TriggersListProps) {
  const { t } = useTranslation("schema");
  return (
    <StructureShell>
      <StructureActionBar
        count={
          triggers.length === 1
            ? t("triggerCount_one", { count: triggers.length })
            : t("triggerCount_other", { count: triggers.length })
        }
        actions={
          supportsStructuredCrud ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={onCreate}
              aria-label={t("createTriggerAria")}
            >
              <Plus />
              Trigger
            </Button>
          ) : null
        }
      />
      {triggers.length === 0 ? (
        <StructureEmpty>{t("noTriggers")}</StructureEmpty>
      ) : (
        <div className="flex-1 overflow-auto p-3">
          <ul className="flex flex-col gap-3">
            {triggers.map((trigger) => (
              <li
                key={`${trigger.schema}.${trigger.table}.${trigger.name}`}
                className="rounded border border-border bg-card p-3"
                aria-label={`Trigger ${trigger.name}`}
              >
                <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {trigger.name}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {trigger.timing} {trigger.events.join(" OR ")} · FOR EACH{" "}
                    {trigger.orientation}
                  </span>
                  {supportsStructuredCrud && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onDrop(trigger.name)}
                      aria-label={t("dropTriggerAria", { name: trigger.name })}
                      title={t("dropTriggerTitle", { name: trigger.name })}
                      className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </header>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-2xs">
                  <dt className="text-muted-foreground">
                    {t("functionLabel")}
                  </dt>
                  <dd className="font-mono text-foreground">
                    {trigger.functionSchema}.{trigger.functionName}
                    {trigger.arguments ? `(${trigger.arguments})` : "()"}
                  </dd>
                  {trigger.whenExpression && (
                    <>
                      <dt className="text-muted-foreground">
                        {t("whenLabel")}
                      </dt>
                      <dd className="font-mono text-foreground">
                        {trigger.whenExpression}
                      </dd>
                    </>
                  )}
                </dl>
                <pre
                  data-testid={`trigger-source-${trigger.name}`}
                  className="mt-2 max-h-72 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-2xs text-foreground"
                >
                  {trigger.definition}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StructureShell>
  );
}
