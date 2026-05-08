import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import OrderedColumnPicker from "./OrderedColumnPicker";

/**
 * `IndexesTabBody` — Sprint 228 (Phase 27 sprint 3) extraction.
 *
 * Why a sub-component:
 *   - Sprint 228's editor body grew the parent `CreateTableDialog.tsx`
 *     past the project's 700-LOC threshold (`docs/sprints/sprint-228/
 *     contract.md` → "no anticipatory abstraction" + Generator's call
 *     to extract). Pulling the JSX out keeps the parent under that
 *     ceiling without changing any state ownership: index drafts +
 *     handlers + dedup logic still live in the parent. This file is
 *     a pure presentational mapper from props → DOM.
 *
 * Shape:
 *   - The parent owns `indexes: IndexDraft[]` and the four mutators
 *     (`onAdd` / `onRemove` / `onUpdate` / `onToggleColumn`). Render
 *     decisions like "skipped because PK matches" are computed by the
 *     parent (`isPkDuplicate(idx)`) so the dedup rule lives next to
 *     the chain closure that consumes it.
 *
 * Source: parent's prior inline JSX (sprint-228 implementation pass);
 * extraction is mechanical — no behavioural change.
 */

/**
 * The four UI-exposed PostgreSQL index types. Backend's
 * `validate_index_type` accepts `brin` too, but the UI hides it for
 * DataGrip parity (Sprint 228 contract `Out of Scope`).
 */
export type IndexType = "btree" | "hash" | "gin" | "gist";

export const INDEX_TYPE_OPTIONS: readonly IndexType[] = [
  "btree",
  "hash",
  "gin",
  "gist",
];

export interface IndexDraft {
  trackingId: string;
  name: string;
  columns: string[];
  index_type: IndexType;
  unique: boolean;
}

export interface IndexesTabBodyProps {
  /** Current index drafts. Empty array = the "no indexes declared" empty state. */
  indexes: IndexDraft[];
  /**
   * Live-derived list of column names from the Columns tab (only those
   * with a non-empty trimmed `name`). Drives the per-row column
   * checkbox group.
   */
  availableColumns: string[];
  /**
   * Returns true iff the row's `columns` array exactly matches the
   * declared PK array (same names, same order). Drives the inline
   * "Skipped — primary key is already indexed" annotation. Computed
   * by the parent so the dedup rule lives next to the chain closure.
   */
  isPkDuplicate: (draft: IndexDraft) => boolean;
  onAdd: () => void;
  onRemove: (trackingId: string) => void;
  onUpdate: (trackingId: string, updates: Partial<IndexDraft>) => void;
  /**
   * Legacy single-toggle handler — kept on the prop interface for the
   * Sprint 228 test surface that drove the old checkbox UI. The new
   * `OrderedColumnPicker` calls `onUpdate(trackingId, { columns: next })`
   * with the full ordered array on every mutation, so this prop is no
   * longer wired internally; callers can pass a stub.
   */
  onToggleColumn: (trackingId: string, colName: string) => void;
  /**
   * Sprint 234 — reorder callback. `direction = -1` moves the row up by
   * one position; `+1` moves it down. Boundary clicks (top row up,
   * bottom row down) are no-ops at the parent — buttons render
   * `disabled` here too as defense-in-depth.
   */
  onMove: (trackingId: string, direction: -1 | 1) => void;
}

export default function IndexesTabBody({
  indexes,
  availableColumns,
  isPkDuplicate,
  onAdd,
  onRemove,
  onUpdate,
  onMove,
}: IndexesTabBodyProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-secondary-foreground">
          Indexes
        </label>
        <Button
          variant="ghost"
          size="xs"
          onClick={onAdd}
          aria-label="Add index"
        >
          <Plus />
          Index
        </Button>
      </div>
      {indexes.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-background p-4 text-center">
          <p className="text-xs italic text-muted-foreground">
            No indexes declared. PostgreSQL implicitly indexes primary-key
            columns; click &quot;+ Index&quot; to declare additional indexes.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {indexes.map((idx, position) => {
            const dedupe = isPkDuplicate(idx);
            // Sprint 234 — boundary booleans for the ↑/↓ reorder
            // buttons: the topmost row's ↑ is disabled, the bottommost
            // row's ↓ is disabled. Defense-in-depth — the parent
            // `onMove` handler also no-ops on boundary clicks.
            const isFirst = position === 0;
            const isLast = position === indexes.length - 1;
            return (
              <div
                key={idx.trackingId}
                className="flex items-start gap-1.5 rounded border border-border bg-background p-2"
              >
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <input
                      className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                      value={idx.name}
                      onChange={(e) =>
                        onUpdate(idx.trackingId, { name: e.target.value })
                      }
                      placeholder="index_name"
                      aria-label="Index name"
                    />
                    <Select
                      value={idx.index_type}
                      onValueChange={(next) =>
                        onUpdate(idx.trackingId, {
                          index_type: next as IndexType,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label="Index type"
                        size="sm"
                        className="w-24"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INDEX_TYPE_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex cursor-pointer items-center gap-1 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={idx.unique}
                        onChange={(e) =>
                          onUpdate(idx.trackingId, {
                            unique: e.target.checked,
                          })
                        }
                        className="rounded border-border"
                        aria-label="Index unique"
                      />
                      Unique
                    </label>
                  </div>
                  <OrderedColumnPicker
                    available={availableColumns}
                    selected={idx.columns}
                    onChange={(next) =>
                      onUpdate(idx.trackingId, { columns: next })
                    }
                    ariaLabelPrefix="Index column"
                    emptyMessage="Add named columns in the Columns tab to use this picker."
                  />
                  {dedupe && (
                    <p className="text-xs italic text-muted-foreground">
                      Skipped — primary key is already indexed
                    </p>
                  )}
                </div>
                {/* Sprint 234 — ↑ / ↓ reorder buttons (left of `−`). */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onMove(idx.trackingId, -1)}
                  disabled={isFirst}
                  aria-label="Move index up"
                  title="Move index up"
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onMove(idx.trackingId, 1)}
                  disabled={isLast}
                  aria-label="Move index down"
                  title="Move index down"
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRemove(idx.trackingId)}
                  aria-label="Remove index"
                  title="Remove index"
                >
                  <Minus />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
