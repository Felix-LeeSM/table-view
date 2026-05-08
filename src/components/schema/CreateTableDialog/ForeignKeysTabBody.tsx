import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import OrderedColumnPicker from "./OrderedColumnPicker";

// Sprint 241 — sub-tabs split FK / CHECK / UNIQUE. The active panel
// renders one family at a time so a long declaration list in one
// family doesn't crowd the others off-screen. Uses Radix's built-in
// uncontrolled state via `defaultValue="fk"` — no parent-owned tab
// key needed.

/**
 * `ForeignKeysTabBody` — Sprint 229 (Phase 27 sprint 4) extraction.
 *
 * Why a sub-component:
 *   - Sprint 228's Indexes-tab editor body grew the parent
 *     `CreateTableDialog.tsx` past the project's 700-LOC threshold
 *     (extracted `IndexesTabBody.tsx` to drop it back to 793). Sprint
 *     229's Foreign Keys tab adds three sub-sections (FK / CHECK /
 *     UNIQUE) and ~280 LOC of JSX; inlining would push the parent
 *     past 1000. Per Sprint 229 contract Concerns #1 the editor body
 *     is mandatorily extracted to a sibling sub-component, mirroring
 *     the Sprint 228 `IndexesTabBody.tsx` precedent.
 *
 * Shape:
 *   - Pure presentational mapper. Owns no state. The parent owns the
 *     three draft arrays (`fks`, `checks`, `uniques`) + the matching
 *     mutator callbacks. Reference-schema-keyed cache slices flow
 *     in as `refTablesByKey` / `refColumnsByKey` (the parent threads
 *     them from `useSchemaStore.getState().tables` /
 *     `tableColumnsCache`).
 *
 * Tab layout:
 *   - One Foreign Keys tab containing **three labeled sub-sections**:
 *     "Foreign Keys" (per-row name + local cols + ref schema/table/
 *     cols + ON DELETE + ON UPDATE), "CHECK constraints" (per-row
 *     name + expression input), "Unique constraints" (per-row name +
 *     columns multi-checkbox). Each sub-section's empty state is the
 *     dashed-border "No <name> declared. Click '+ <button>' to add
 *     one." pattern from Sprint 228 `IndexesTabBody.tsx`.
 *
 * Source: Sprint 229 contract `docs/sprints/sprint-229/contract.md`
 * "Design Bar / Quality Bar".
 */

/**
 * The five PG-canonical referential actions for FK ON DELETE / ON
 * UPDATE clauses. Backend whitelists this exact set (case-sensitive
 * uppercase) — see `src-tauri/src/db/postgres/mutations.rs`
 * `format_referential_action_clause`.
 */
export type ReferentialAction =
  | "NO ACTION"
  | "RESTRICT"
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT";

export const REFERENTIAL_ACTIONS: readonly ReferentialAction[] = [
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
];

export interface ForeignKeyDraft {
  trackingId: string;
  name: string;
  /** Local columns selected from `availableColumns`. Order = click order. */
  columns: string[];
  ref_schema: string;
  ref_table: string;
  ref_columns: string[];
  on_delete: ReferentialAction;
  on_update: ReferentialAction;
}

export interface CheckDraft {
  trackingId: string;
  name: string;
  /** Free-text SQL expression. Single-line; backend trims + non-empty check. */
  expression: string;
}

export interface UniqueDraft {
  trackingId: string;
  name: string;
  /** Selected columns from `availableColumns`. Order = click order. */
  columns: string[];
}

export interface ForeignKeysTabBodyProps {
  fks: ForeignKeyDraft[];
  checks: CheckDraft[];
  uniques: UniqueDraft[];
  /**
   * Live-derived list of column names from the Columns tab (only those
   * with a non-empty trimmed `name`). Drives the FK local-columns +
   * UNIQUE columns multi-checkbox groups.
   */
  availableColumns: string[];
  /** Schemas available on the connection — drives the ref-schema dropdown. */
  availableSchemas: string[];
  /**
   * Cached reference-table list keyed by `${connectionId}:${refSchema}`.
   * Source: `useSchemaStore.tables`. When the key is missing the parent
   * triggers a one-shot `loadTables` (AC-229-09) and falls back to a
   * free-text input until the load resolves.
   */
  refTablesByKey: Record<string, string[]>;
  /**
   * Cached reference-column list keyed by
   * `${connectionId}:${refSchema}:${refTable}`. Source:
   * `useSchemaStore.tableColumnsCache`. Same fallback semantics as
   * `refTablesByKey`.
   */
  refColumnsByKey: Record<string, string[]>;
  /**
   * Per-row "ref columns are loading" flag — set true between picking
   * a ref-table and the columns cache being populated. Drives the
   * disabled state of the ref-columns checkbox group.
   */
  fkRefColumnsLoadingByTrackingId: Record<string, boolean>;
  onAddFk: () => void;
  onRemoveFk: (trackingId: string) => void;
  onUpdateFk: (trackingId: string, updates: Partial<ForeignKeyDraft>) => void;
  /**
   * Legacy single-toggle handlers — kept on the prop interface for the
   * Sprint 229 test surface that drove the old multi-checkbox UI. The
   * new `OrderedColumnPicker` calls `onUpdateFk(trackingId, { columns })`
   * / `onUpdateFk(trackingId, { ref_columns })` /
   * `onUpdateUnique(trackingId, { columns })` with the full ordered
   * array on every mutation, so these props are no longer wired
   * internally; callers can pass stubs.
   */
  onToggleFkLocalColumn: (trackingId: string, colName: string) => void;
  onToggleFkRefColumn: (trackingId: string, colName: string) => void;
  onAddCheck: () => void;
  onRemoveCheck: (trackingId: string) => void;
  onUpdateCheck: (trackingId: string, updates: Partial<CheckDraft>) => void;
  onAddUnique: () => void;
  onRemoveUnique: (trackingId: string) => void;
  onUpdateUnique: (trackingId: string, updates: Partial<UniqueDraft>) => void;
  /** Legacy — see comment above on `onToggleFkLocalColumn`. */
  onToggleUniqueColumn: (trackingId: string, colName: string) => void;
  /**
   * Sprint 234 — three reorder callbacks (one per family). Same swap-
   * in-place semantics as the column / index reorder. Boundary clicks
   * are no-ops at the parent; the buttons render `disabled` here too
   * for defense-in-depth.
   */
  onMoveFk: (trackingId: string, direction: -1 | 1) => void;
  onMoveCheck: (trackingId: string, direction: -1 | 1) => void;
  onMoveUnique: (trackingId: string, direction: -1 | 1) => void;
}

export default function ForeignKeysTabBody({
  fks,
  checks,
  uniques,
  availableColumns,
  availableSchemas,
  refTablesByKey,
  refColumnsByKey,
  fkRefColumnsLoadingByTrackingId,
  onAddFk,
  onRemoveFk,
  onUpdateFk,
  onAddCheck,
  onRemoveCheck,
  onUpdateCheck,
  onAddUnique,
  onRemoveUnique,
  onUpdateUnique,
  onMoveFk,
  onMoveCheck,
  onMoveUnique,
}: ForeignKeysTabBodyProps) {
  // Sprint 241 — sub-tab state. Default lands on `fk` because the
  // Constraints tab's most common destination after the column-row
  // inline path is multi-column foreign keys. Tab labels carry an
  // `(N)` count suffix so the user sees at a glance which families
  // already have declarations. Uncontrolled (`defaultValue`) so RTL
  // tests can drive a Tab change with a single `fireEvent.click` —
  // controlled-state Tabs needed an extra `await act` flush which
  // proved flaky in the standalone-render test setup.
  return (
    <div className="space-y-3">
      {/* Sprint 241 — sub-tabs split FK / CHECK / UNIQUE. Per-family
          scope reminders live inside each TabsContent so the user
          sees the relevant guidance without scanning a generic
          banner. */}
      <Tabs defaultValue="fk">
        <TabsList className="w-full justify-start gap-0 rounded-none border-b border-border">
          <TabsTrigger value="fk" className="rounded-none">
            Foreign Keys
            {fks.length > 0 && (
              <span className="ml-1 text-3xs text-muted-foreground">
                ({fks.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="check" className="rounded-none">
            CHECK
            {checks.length > 0 && (
              <span className="ml-1 text-3xs text-muted-foreground">
                ({checks.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="unique" className="rounded-none">
            UNIQUE
            {uniques.length > 0 && (
              <span className="ml-1 text-3xs text-muted-foreground">
                ({uniques.length})
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fk" className="pt-3 data-[state=inactive]:hidden">
          {/* Sprint 241 — per-family scope reminder. Inline-cell path
              for the single-column case, this tab for the multi-column
              variant. */}
          <p className="mb-2 text-2xs text-muted-foreground">
            Single-column foreign keys are edited inline on the column row
            (Columns tab). Use this tab when the FK spans multiple local columns
            (e.g. composite FK).
          </p>
          {/* ── Foreign Keys sub-section ─────────────────────────────── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-secondary-foreground">
                Foreign Keys
              </label>
              <Button
                variant="ghost"
                size="xs"
                onClick={onAddFk}
                aria-label="Add foreign key"
              >
                <Plus />
                Foreign Key
              </Button>
            </div>
            {fks.length === 0 ? (
              <div className="rounded border border-dashed border-border bg-background p-4 text-center">
                <p className="text-xs italic text-muted-foreground">
                  No foreign keys declared. Click &quot;+ Foreign Key&quot; to
                  add one.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {fks.map((fk, position) => {
                  const refTables =
                    refTablesByKey[`${fk.ref_schema}`] ??
                    refTablesByKey[fk.ref_schema] ??
                    [];
                  const refColsKey = `${fk.ref_schema}:${fk.ref_table}`;
                  const refCols = refColumnsByKey[refColsKey] ?? [];
                  const refColsLoading =
                    fkRefColumnsLoadingByTrackingId[fk.trackingId] === true;
                  // Sprint 234 — boundary-disabled flags for ↑/↓.
                  const isFirst = position === 0;
                  const isLast = position === fks.length - 1;
                  return (
                    <div
                      key={fk.trackingId}
                      className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
                    >
                      <div className="flex flex-1 flex-col gap-1.5">
                        <input
                          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                          value={fk.name}
                          onChange={(e) =>
                            onUpdateFk(fk.trackingId, { name: e.target.value })
                          }
                          placeholder="fk_table_column"
                          aria-label="Foreign key name"
                        />

                        {/* Local columns ordered picker. */}
                        <OrderedColumnPicker
                          available={availableColumns}
                          selected={fk.columns}
                          onChange={(next) =>
                            onUpdateFk(fk.trackingId, { columns: next })
                          }
                          ariaLabelPrefix="Foreign key local column"
                          emptyMessage="Add named columns in the Columns tab to use this picker."
                        />

                        {/* Reference schema + table */}
                        <div className="flex gap-1.5">
                          <Select
                            value={fk.ref_schema}
                            onValueChange={(next) =>
                              onUpdateFk(fk.trackingId, {
                                ref_schema: next,
                                ref_table: "",
                                ref_columns: [],
                              })
                            }
                          >
                            <SelectTrigger
                              aria-label="Foreign key reference schema"
                              size="sm"
                              className="flex-1"
                            >
                              <SelectValue placeholder="schema" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableSchemas.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {refTables.length > 0 ? (
                            <Select
                              value={fk.ref_table}
                              onValueChange={(next) =>
                                onUpdateFk(fk.trackingId, {
                                  ref_table: next,
                                  ref_columns: [],
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label="Foreign key reference table"
                                size="sm"
                                className="flex-1"
                              >
                                <SelectValue placeholder="reference_table" />
                              </SelectTrigger>
                              <SelectContent>
                                {refTables.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            // Cache miss / load-in-flight / connection offline:
                            // free-text fallback so the user can still type the
                            // table name. Backend `validate_identifier` rejects
                            // malformed names.
                            <input
                              className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                              value={fk.ref_table}
                              onChange={(e) =>
                                onUpdateFk(fk.trackingId, {
                                  ref_table: e.target.value,
                                  ref_columns: [],
                                })
                              }
                              placeholder="reference_table_name"
                              aria-label="Foreign key reference table"
                            />
                          )}
                        </div>

                        {/* Reference columns. Three render modes:
                        (1) no ref-table picked yet — hint to pick first;
                        (2) ref-cols cache load in flight — disabled spinner;
                        (3) cache miss / fetch failed — comma-text fallback;
                        otherwise the OrderedColumnPicker. */}
                        {fk.ref_table.trim().length === 0 ? (
                          <div
                            className="rounded border border-border bg-background p-2"
                            aria-label="Foreign key reference columns"
                          >
                            <span className="text-xs italic text-muted-foreground">
                              Pick a reference table to choose reference columns
                            </span>
                          </div>
                        ) : refColsLoading ? (
                          <div
                            className="rounded border border-border bg-background p-2"
                            aria-label="Foreign key reference columns"
                          >
                            <span className="text-xs italic text-muted-foreground">
                              Loading reference columns…
                            </span>
                          </div>
                        ) : refCols.length === 0 ? (
                          <div
                            className="rounded border border-border bg-background p-2"
                            aria-label="Foreign key reference columns"
                          >
                            <input
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                              value={fk.ref_columns.join(", ")}
                              onChange={(e) =>
                                onUpdateFk(fk.trackingId, {
                                  ref_columns: e.target.value
                                    .split(",")
                                    .map((c) => c.trim())
                                    .filter((c) => c.length > 0),
                                })
                              }
                              placeholder="id, ..."
                              aria-label="Foreign key reference columns text"
                            />
                          </div>
                        ) : (
                          <OrderedColumnPicker
                            available={refCols}
                            selected={fk.ref_columns}
                            onChange={(next) =>
                              onUpdateFk(fk.trackingId, { ref_columns: next })
                            }
                            ariaLabelPrefix="Foreign key reference column"
                            emptyMessage="No reference columns available"
                          />
                        )}

                        {/* ON DELETE / ON UPDATE */}
                        <div className="flex gap-1.5">
                          <div className="flex flex-1 items-center gap-1">
                            <span className="text-xs text-muted-foreground">
                              ON DELETE
                            </span>
                            <Select
                              value={fk.on_delete}
                              onValueChange={(next) =>
                                onUpdateFk(fk.trackingId, {
                                  on_delete: next as ReferentialAction,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label="Foreign key on delete"
                                size="sm"
                                className="flex-1"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {REFERENTIAL_ACTIONS.map((a) => (
                                  <SelectItem key={a} value={a}>
                                    {a}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-1 items-center gap-1">
                            <span className="text-xs text-muted-foreground">
                              ON UPDATE
                            </span>
                            <Select
                              value={fk.on_update}
                              onValueChange={(next) =>
                                onUpdateFk(fk.trackingId, {
                                  on_update: next as ReferentialAction,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label="Foreign key on update"
                                size="sm"
                                className="flex-1"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {REFERENTIAL_ACTIONS.map((a) => (
                                  <SelectItem key={a} value={a}>
                                    {a}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      {/* Sprint 234 — ↑ / ↓ reorder buttons (left of `−`). */}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMoveFk(fk.trackingId, -1)}
                        disabled={isFirst}
                        aria-label="Move foreign key up"
                        title="Move foreign key up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMoveFk(fk.trackingId, 1)}
                        disabled={isLast}
                        aria-label="Move foreign key down"
                        title="Move foreign key down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onRemoveFk(fk.trackingId)}
                        aria-label="Remove foreign key"
                        title="Remove foreign key"
                      >
                        <Minus />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="check"
          className="pt-3 data-[state=inactive]:hidden"
        >
          <p className="mb-2 text-2xs text-muted-foreground">
            Single-column CHECK expressions live inline on the column row
            (Columns tab). Use this tab for CHECK expressions that reference
            multiple columns (e.g. <code>start_at &lt; end_at</code>).
          </p>
          {/* ── CHECK constraints sub-section ────────────────────────── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-secondary-foreground">
                CHECK constraints
              </label>
              <Button
                variant="ghost"
                size="xs"
                onClick={onAddCheck}
                aria-label="Add check"
              >
                <Plus />
                CHECK
              </Button>
            </div>
            {checks.length === 0 ? (
              <div className="rounded border border-dashed border-border bg-background p-4 text-center">
                <p className="text-xs italic text-muted-foreground">
                  No CHECK constraints declared. Click &quot;+ CHECK&quot; to
                  add one.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {checks.map((c, position) => {
                  // Sprint 234 — ↑/↓ boundary flags.
                  const isFirst = position === 0;
                  const isLast = position === checks.length - 1;
                  return (
                    <div
                      key={c.trackingId}
                      className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
                    >
                      <div className="flex flex-1 flex-col gap-1.5">
                        <input
                          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                          value={c.name}
                          onChange={(e) =>
                            onUpdateCheck(c.trackingId, {
                              name: e.target.value,
                            })
                          }
                          placeholder="chk_table_n"
                          aria-label="Check name"
                        />
                        <input
                          type="text"
                          className="rounded border border-border bg-background px-2 py-1 text-xs font-mono text-foreground outline-none focus:border-primary"
                          value={c.expression}
                          onChange={(e) =>
                            onUpdateCheck(c.trackingId, {
                              expression: e.target.value,
                            })
                          }
                          placeholder="age >= 0"
                          aria-label="Check expression"
                        />
                      </div>
                      {/* Sprint 234 — ↑ / ↓ reorder buttons (left of `−`). */}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMoveCheck(c.trackingId, -1)}
                        disabled={isFirst}
                        aria-label="Move check up"
                        title="Move check up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMoveCheck(c.trackingId, 1)}
                        disabled={isLast}
                        aria-label="Move check down"
                        title="Move check down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onRemoveCheck(c.trackingId)}
                        aria-label="Remove check"
                        title="Remove check"
                      >
                        <Minus />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="unique"
          className="pt-3 data-[state=inactive]:hidden"
        >
          <p className="mb-2 text-2xs text-muted-foreground">
            Per-column uniqueness is set in the Keys tab (mark the column as PK)
            or via a single-column UNIQUE row here. Use this tab when uniqueness
            must hold across multiple columns together (e.g.{" "}
            <code>(tenant_id, email)</code>).
          </p>
          {/* ── Table-level UNIQUE constraints sub-section ───────────── */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-secondary-foreground">
                Unique constraints
              </label>
              <Button
                variant="ghost"
                size="xs"
                onClick={onAddUnique}
                aria-label="Add unique"
              >
                <Plus />
                Unique
              </Button>
            </div>
            {uniques.length === 0 ? (
              <div className="rounded border border-dashed border-border bg-background p-4 text-center">
                <p className="text-xs italic text-muted-foreground">
                  No table-level UNIQUE constraints declared. Click &quot;+
                  Unique&quot; to add one.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {uniques.map((u, position) => {
                  // Sprint 234 — ↑/↓ boundary flags.
                  const isFirst = position === 0;
                  const isLast = position === uniques.length - 1;
                  return (
                    <div
                      key={u.trackingId}
                      className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
                    >
                      <div className="flex flex-1 flex-col gap-1.5">
                        <input
                          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                          value={u.name}
                          onChange={(e) =>
                            onUpdateUnique(u.trackingId, {
                              name: e.target.value,
                            })
                          }
                          placeholder="uq_table_columns"
                          aria-label="Unique name"
                        />
                        <OrderedColumnPicker
                          available={availableColumns}
                          selected={u.columns}
                          onChange={(next) =>
                            onUpdateUnique(u.trackingId, { columns: next })
                          }
                          ariaLabelPrefix="Unique column"
                          emptyMessage="Add named columns in the Columns tab to use this picker."
                        />
                      </div>
                      {/* Sprint 234 — ↑ / ↓ reorder buttons (left of `−`). */}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMoveUnique(u.trackingId, -1)}
                        disabled={isFirst}
                        aria-label="Move unique up"
                        title="Move unique up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onMoveUnique(u.trackingId, 1)}
                        disabled={isLast}
                        aria-label="Move unique down"
                        title="Move unique down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onRemoveUnique(u.trackingId)}
                        aria-label="Remove unique"
                        title="Remove unique"
                      >
                        <Minus />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
