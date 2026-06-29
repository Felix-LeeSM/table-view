// Sprint 241 — inline FK editor surfaced on each `CreateTableDialog`
// column row (TablePlus parity). The popover lets the user pick a
// reference schema / table / column + ON DELETE / ON UPDATE actions
// for *single-column* foreign keys. Multi-column FKs continue to live
// in the Constraints tab.
//
// Date: 2026-05-08.
//
// Why this file exists:
//   - `CreateTableDialog.tsx` is already at 1900+ LOC; inlining a
//     full popover (combobox × 3 + dropdown × 2) would push it past
//     the de-facto file ceiling.
//   - The popover surface is self-contained: parent passes the
//     current FK fields + lazy-loaded ref schemas / tables / columns
//     and one `onChange(updates)` callback. No back-channel to the
//     parent's state machine beyond that callback.
//
// The trigger label collapses to `+ FK` when no FK is set on the
// column, and `FK → <table>.<column>` once the user has picked a
// target — same affordance pattern TablePlus uses on its inline
// `foreign_key` cell.

import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { Button } from "@components/ui/button";
import { X } from "lucide-react";

const REFERENTIAL_ACTIONS = [
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
] as const;

export interface InlineFkValue {
  ref_schema: string;
  ref_table: string;
  ref_column: string;
  on_delete: string;
  on_update: string;
}

export interface InlineFkPopoverProps {
  /**
   * Stable identifier for the parent column row — used as the popover
   * `aria-label` suffix so the test can target one row's popover when
   * multiple columns coexist.
   */
  columnTrackingId: string;
  /** Live FK fields snapshot. */
  value: InlineFkValue;
  /** Default schema fallback (the table's own schema). */
  defaultSchema: string;
  /** Schema picker options — same list as the dialog's Target schema. */
  availableSchemas: string[];
  /**
   * `refTablesByKey[<refSchema>]` — list of table names visible in the
   * given schema. Empty when the lazy fetch hasn't run yet.
   */
  refTablesByKey: Record<string, string[]>;
  /**
   * `refColumnsByKey[<refSchema>:<refTable>]` — list of column names
   * for the picked target table. Empty when the lazy fetch hasn't run.
   */
  refColumnsByKey: Record<string, string[]>;
  /** Lazy-loader: parent calls when ref_schema changes. */
  onSchemaPicked: (schema: string) => void;
  /** Lazy-loader: parent calls when ref_table changes. */
  onTablePicked: (schema: string, table: string) => void;
  /** Updates the column's FK fields. */
  onChange: (updates: Partial<InlineFkValue>) => void;
  /**
   * Clears every FK field on the column (`{ref_table:"", ref_column:""}`).
   * Surfaces the popover's "Remove" action; chain builder's empty-
   * `ref_table` filter then drops the FK from the constraint chain.
   */
  onClear: () => void;
}

/**
 * Renders the inline FK editor + its trigger button. Trigger label:
 *   `+ FK` ........................ when `ref_table` is empty
 *   `FK → <table>.<column>` ........ when both fields are populated
 *   `FK → <table>.?` ............... when only `ref_table` is set
 */
export default function InlineFkPopover({
  columnTrackingId,
  value,
  defaultSchema,
  availableSchemas,
  refTablesByKey,
  refColumnsByKey,
  onSchemaPicked,
  onTablePicked,
  onChange,
  onClear,
}: InlineFkPopoverProps) {
  const { t } = useTranslation("schemaDialogs");
  const refSchema =
    value.ref_schema.trim().length > 0 ? value.ref_schema : defaultSchema;
  const tablesForSchema = refTablesByKey[refSchema] ?? [];
  const refColsKey = `${refSchema}:${value.ref_table}`;
  const colsForTable = refColumnsByKey[refColsKey] ?? [];
  const triggerLabel = value.ref_table.trim()
    ? `FK → ${value.ref_table}.${value.ref_column.trim() || "?"}`
    : "+ FK";
  const isSet = value.ref_table.trim().length > 0;
  const headingId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            isSet
              ? "rounded border border-primary/40 bg-primary/10 px-2 py-1 text-2xs text-foreground hover:border-primary"
              : "rounded border border-dashed border-border px-2 py-1 text-2xs text-muted-foreground hover:border-primary hover:text-foreground"
          }
          aria-label={t("inlineFk.columnFkAria", {
            trackingId: columnTrackingId,
          })}
          title={isSet ? triggerLabel : t("inlineFk.triggerNoFkTitle")}
        >
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 space-y-2 p-3"
        aria-labelledby={headingId}
      >
        <div className="flex items-center justify-between">
          <span id={headingId} className="text-xs font-medium">
            {t("inlineFk.popoverTitle")}
          </span>
          {isSet && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClear}
              aria-label={t("inlineFk.clearAria")}
              title={t("inlineFk.clearTitle")}
            >
              <X />
            </Button>
          )}
        </div>

        <div>
          <label className="mb-0.5 block text-2xs text-muted-foreground">
            {t("inlineFk.refSchemaLabel")}
          </label>
          <Select
            value={refSchema}
            onValueChange={(next) => {
              onChange({ ref_schema: next, ref_table: "", ref_column: "" });
              onSchemaPicked(next);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={t("inlineFk.refSchemaAria")}
            >
              <SelectValue placeholder={defaultSchema} />
            </SelectTrigger>
            <SelectContent>
              {availableSchemas.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-0.5 block text-2xs text-muted-foreground">
            {t("inlineFk.refTableLabel")}
          </label>
          {tablesForSchema.length > 0 ? (
            <Select
              value={value.ref_table}
              onValueChange={(next) => {
                onChange({ ref_table: next, ref_column: "" });
                onTablePicked(refSchema, next);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("inlineFk.refTablePickAria")}
              >
                <SelectValue placeholder="(pick table)" />
              </SelectTrigger>
              <SelectContent>
                {tablesForSchema.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              value={value.ref_table}
              onChange={(e) => onChange({ ref_table: e.target.value })}
              placeholder={t("inlineFk.refTableInputPlaceholder")}
              aria-label={t("inlineFk.refTableInputAria")}
            />
          )}
        </div>

        <div>
          <label className="mb-0.5 block text-2xs text-muted-foreground">
            {t("inlineFk.refColumnLabel")}
          </label>
          {colsForTable.length > 0 ? (
            <Select
              value={value.ref_column}
              onValueChange={(next) => onChange({ ref_column: next })}
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("inlineFk.refColumnPickAria")}
              >
                <SelectValue placeholder="(pick column)" />
              </SelectTrigger>
              <SelectContent>
                {colsForTable.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              value={value.ref_column}
              onChange={(e) => onChange({ ref_column: e.target.value })}
              placeholder={t("inlineFk.refColumnInputPlaceholder")}
              aria-label={t("inlineFk.refColumnInputAria")}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-2xs text-muted-foreground">
              {t("inlineFk.onDeleteLabel")}
            </label>
            <Select
              value={value.on_delete}
              onValueChange={(next) => onChange({ on_delete: next })}
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("inlineFk.onDeleteAria")}
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
          <div>
            <label className="mb-0.5 block text-2xs text-muted-foreground">
              {t("inlineFk.onUpdateLabel")}
            </label>
            <Select
              value={value.on_update}
              onValueChange={(next) => onChange({ on_update: next })}
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("inlineFk.onUpdateAria")}
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
      </PopoverContent>
    </Popover>
  );
}
