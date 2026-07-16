import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import CreateTableTypeCombobox from "../CreateTableTypeCombobox";
import InlineFkPopover from "./InlineFkPopover";
import type { ColumnDraft } from "./types";
import type { usePostgresTypes } from "@hooks/usePostgresTypes";
import type { SchemaName, TableName } from "@/types/branded";

type PgTypes = ReturnType<typeof usePostgresTypes>["types"];
type PgTypesByName = ReturnType<typeof usePostgresTypes>["typesByName"];

export interface ColumnsTabBodyProps {
  columns: ColumnDraft[];
  /** Live PG type suggestions + type-kind map for the per-row combobox. */
  pgTypes: PgTypes;
  pgTypesByName: PgTypesByName;
  /** Target schema — default schema for inline FK popovers. */
  selectedSchema: string;
  /** Schemas available on the connection — drives the inline FK schema picker. */
  schemaOptions: string[];
  refTablesByKey: Record<string, string[]>;
  refColumnsByKey: Record<string, string[]>;
  /** Lazy-load hooks for the inline FK popover. Branded `(schema, table)`
   * order — issue #1495. */
  onSchemaPicked: (schema: SchemaName) => void;
  onTablePicked: (schema: SchemaName, table: TableName) => void;
  onAddColumn: () => void;
  onRemoveColumn: (trackingId: string) => void;
  onUpdateColumn: (trackingId: string, updates: Partial<ColumnDraft>) => void;
  onMoveColumn: (trackingId: string, direction: -1 | 1) => void;
}

/**
 * `ColumnsTabBody` — Columns tab editor extracted from `CreateTableDialog`.
 * Pure presentational mapper: the parent owns `columns` + the mutators; this
 * file renders the per-row name/type/nullable/identity/default/comment inputs
 * plus the inline single-column FK popover and CHECK expression input.
 */
export default function ColumnsTabBody({
  columns,
  pgTypes,
  pgTypesByName,
  selectedSchema,
  schemaOptions,
  refTablesByKey,
  refColumnsByKey,
  onSchemaPicked,
  onTablePicked,
  onAddColumn,
  onRemoveColumn,
  onUpdateColumn,
  onMoveColumn,
}: ColumnsTabBodyProps) {
  const { t } = useTranslation("schemaDialogs");
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-secondary-foreground">
          {t("createTable.columnsLabel")}
        </label>
        <Button
          variant="ghost"
          size="xs"
          onClick={onAddColumn}
          aria-label={t("createTable.addColumnAria")}
        >
          <Plus />
          {t("createTable.addColumnBtn")}
        </Button>
      </div>
      {/* Single-layer scroll. Long lists flow naturally inside the dialog
          body's outer scroll region; the row container itself does not
          introduce a second scroll axis. */}
      <div className="space-y-1">
        {columns.map((col, position) => {
          // Boundary flags for the up/down reorder buttons.
          const isFirst = position === 0;
          const isLast = position === columns.length - 1;
          return (
            <div
              key={col.trackingId}
              className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
            >
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex gap-1.5">
                  <input
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                    value={col.name}
                    onChange={(e) =>
                      onUpdateColumn(col.trackingId, {
                        name: e.target.value,
                      })
                    }
                    placeholder={t("createTable.columnNamePlaceholder")}
                    aria-label={t("createTable.columnNameAria")}
                  />
                  <div className="flex-1">
                    <CreateTableTypeCombobox
                      value={col.data_type}
                      typesSource={pgTypes}
                      typeKindMap={pgTypesByName}
                      onChange={(next) =>
                        onUpdateColumn(col.trackingId, {
                          data_type: next,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* IDENTITY columns are SQL-standard NOT NULL and the
                      sequence acts as the default, so nullable +
                      default-value inputs are disabled when identity is on. */}
                  <label
                    className={`flex cursor-pointer items-center gap-1 text-xs text-foreground ${col.is_identity ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={col.nullable && !col.is_identity}
                      onChange={(e) =>
                        onUpdateColumn(col.trackingId, {
                          nullable: e.target.checked,
                        })
                      }
                      disabled={col.is_identity}
                      className="rounded border-border"
                      aria-label={t("createTable.columnNullableAria")}
                    />
                    {t("createTable.columnNullableLabel")}
                  </label>
                  <label
                    className="flex cursor-pointer items-center gap-1 text-xs text-foreground"
                    title={t("createTable.columnIdentityTitle")}
                  >
                    <input
                      type="checkbox"
                      checked={col.is_identity}
                      onChange={(e) =>
                        onUpdateColumn(col.trackingId, {
                          is_identity: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                      aria-label={t("createTable.columnIdentityAria")}
                    />
                    {t("createTable.columnIdentityLabel")}
                  </label>
                  <input
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                    value={col.is_identity ? "" : col.default_value}
                    onChange={(e) =>
                      onUpdateColumn(col.trackingId, {
                        default_value: e.target.value,
                      })
                    }
                    disabled={col.is_identity}
                    placeholder={
                      col.is_identity
                        ? t("createTable.columnDefaultIdentityPlaceholder")
                        : t("createTable.columnDefaultPlaceholder")
                    }
                    aria-label={t("createTable.columnDefaultAria")}
                  />
                </div>
                <input
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                  value={col.comment}
                  onChange={(e) =>
                    onUpdateColumn(col.trackingId, {
                      comment: e.target.value,
                    })
                  }
                  placeholder={t("createTable.columnCommentPlaceholder")}
                  aria-label={t("createTable.columnCommentAria")}
                />
                {/* Inline FK + CHECK on the column row (TablePlus parity).
                    FK is edited via a popover (cell-click pattern);
                    single-column CHECK is a free-text input. Multi-column
                    variants continue to live in the Constraints tab. */}
                <div className="flex items-center gap-1.5">
                  <InlineFkPopover
                    columnTrackingId={col.trackingId}
                    value={{
                      ref_schema: col.fk_ref_schema,
                      ref_table: col.fk_ref_table,
                      ref_column: col.fk_ref_column,
                      on_delete: col.fk_on_delete,
                      on_update: col.fk_on_update,
                    }}
                    defaultSchema={selectedSchema}
                    availableSchemas={schemaOptions}
                    refTablesByKey={refTablesByKey}
                    refColumnsByKey={refColumnsByKey}
                    onSchemaPicked={onSchemaPicked}
                    onTablePicked={onTablePicked}
                    onChange={(updates) => {
                      const mapped: Partial<ColumnDraft> = {};
                      if (updates.ref_schema !== undefined)
                        mapped.fk_ref_schema = updates.ref_schema;
                      if (updates.ref_table !== undefined)
                        mapped.fk_ref_table = updates.ref_table;
                      if (updates.ref_column !== undefined)
                        mapped.fk_ref_column = updates.ref_column;
                      if (updates.on_delete !== undefined)
                        mapped.fk_on_delete = updates.on_delete;
                      if (updates.on_update !== undefined)
                        mapped.fk_on_update = updates.on_update;
                      onUpdateColumn(col.trackingId, mapped);
                    }}
                    onClear={() =>
                      onUpdateColumn(col.trackingId, {
                        fk_ref_schema: "",
                        fk_ref_table: "",
                        fk_ref_column: "",
                        fk_on_delete: "NO ACTION",
                        fk_on_update: "NO ACTION",
                      })
                    }
                  />
                  <input
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                    value={col.check_expression}
                    onChange={(e) =>
                      onUpdateColumn(col.trackingId, {
                        check_expression: e.target.value,
                      })
                    }
                    placeholder={t("createTable.columnCheckPlaceholder")}
                    aria-label={t("createTable.columnCheckAria")}
                  />
                </div>
              </div>
              {/* Up / down reorder buttons (left of the remove button).
                  Boundary-disabled at top/bottom row; the parent handler
                  also no-ops on out-of-range swaps. */}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onMoveColumn(col.trackingId, -1)}
                disabled={isFirst}
                aria-label={t("createTable.moveColumnUpAria")}
                title={t("createTable.moveColumnUpTitle")}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onMoveColumn(col.trackingId, 1)}
                disabled={isLast}
                aria-label={t("createTable.moveColumnDownAria")}
                title={t("createTable.moveColumnDownTitle")}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onRemoveColumn(col.trackingId)}
                disabled={columns.length <= 1}
                aria-label={t("createTable.removeColumnAria")}
                title={
                  columns.length <= 1
                    ? t("createTable.removeColumnDisabledTitle")
                    : t("createTable.removeColumnTitle")
                }
              >
                <Minus />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
