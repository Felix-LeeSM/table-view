import { useTranslation } from "react-i18next";
import type { ColumnDraft } from "./types";

export interface KeysTabBodyProps {
  /** Full column draft list — needed to resolve a PK candidate back to its row. */
  columns: ColumnDraft[];
  /** Live-derived PK candidate names (columns with a non-empty trimmed name). */
  validPkColumns: string[];
  onUpdateColumn: (trackingId: string, updates: Partial<ColumnDraft>) => void;
}

/**
 * `KeysTabBody` — Primary Key tab extracted from `CreateTableDialog`. Pure
 * presentational mapper: renders a checkbox per PK-candidate column, toggling
 * the owning column draft's `is_pk` flag.
 */
export default function KeysTabBody({
  columns,
  validPkColumns,
  onUpdateColumn,
}: KeysTabBodyProps) {
  const { t } = useTranslation("schemaDialogs");
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-secondary-foreground">
        {t("createTable.primaryKeyLabel")}
      </label>
      <div
        className="max-h-scroll-sm overflow-auto rounded border border-border bg-background p-2"
        aria-label={t("createTable.primaryKeyColumnsAria")}
      >
        {validPkColumns.length === 0 ? (
          <span className="text-xs italic text-muted-foreground">
            {t("createTable.primaryKeyEmptyHint")}
          </span>
        ) : (
          validPkColumns.map((colName) => {
            const draft = columns.find((c) => c.name.trim() === colName);
            const checked = !!draft?.is_pk;
            return (
              <label
                key={colName}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (!draft) return;
                    onUpdateColumn(draft.trackingId, {
                      is_pk: e.target.checked,
                    });
                  }}
                  className="rounded border-border"
                  aria-label={t("createTable.primaryKeyColAria", { colName })}
                />
                {colName}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
