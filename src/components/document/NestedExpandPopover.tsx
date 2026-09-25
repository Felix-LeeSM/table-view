import BsonTypeEditor from "@components/document/BsonTypeEditor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import {
  getNestedExpansion,
  type NestedEntry,
} from "@lib/document/nestedExpansion";
import { safeStringifyCell } from "@lib/jsonCell";
import { detectBsonType } from "@lib/mongo/bsonTypes";
import { ChevronRight, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Quick 1-depth inspect of a sentinel cell's contents in a popover.
 *
 * Invariants:
 * - A trigger click does not propagate into row selection (the popover
 *   body stops propagation), so inspecting never toggles selection as a
 *   side effect.
 * - A nested-of-nested entry stays in sentinel notation; deep inspect
 *   belongs to the Quick Look panel.
 */

interface NestedExpandPopoverProps {
  /**
   * Raw nested value (object or array): a `raw_documents` cell or one of
   * its children. The caller swaps a sentinel string back to raw before
   * passing it in.
   */
  value: unknown;
  /** Field name (object key) or column name the user is inspecting. */
  fieldName: string;
  /**
   * Inline edit commit callback for a scalar entry. When omitted the
   * popover is read-only. `path` is dot-notation (object → `"key"`,
   * array → `"0"`, deep entry → `"key.subkey"`). `value` is passed as the
   * raw string the user typed; casting is the caller's responsibility (the
   * BSON editor handles it separately).
   *
   * For a BSON wrapper entry (`{ $oid: ... }` etc.) `value` is a canonical
   * EJSON object rather than a raw string. The caller keeps both in
   * `pendingEdits` the same way — `mqlGenerator` expands them into a
   * mongosh literal (`ObjectId("...")`) for display.
   */
  onCommitEdit?: (
    path: string,
    value: string | Record<string, unknown>,
  ) => void;
  /**
   * Pending value for the current path, if any. Used as the visual cue on
   * display and as the input's initial value.
   */
  pendingByPath?: ReadonlyMap<string, string | Record<string, unknown>>;
}

function renderScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") return safeStringifyCell(value);
  return String(value);
}

function entryLabel(entry: NestedEntry): string {
  return entry.kind === "object-entry" ? entry.key : `[${entry.index}]`;
}

function entryValueText(entry: NestedEntry): string {
  if (entry.isNested) {
    if (Array.isArray(entry.value)) {
      return `[${entry.value.length} items]`;
    }
    return "{...}";
  }
  return renderScalar(entry.value);
}

function entryTypeLabel(entry: NestedEntry): string {
  const v = entry.value;
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") {
    // canonical BSON wrappers — surface `$oid`, `$date`, etc. as the
    // user-visible type.
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 1 && keys[0]!.startsWith("$")) {
      return keys[0]!.slice(1);
    }
    return "object";
  }
  return typeof v;
}

function entryPath(entry: NestedEntry): string {
  return entry.kind === "object-entry" ? entry.key : String(entry.index);
}

export default function NestedExpandPopover({
  value,
  fieldName,
  onCommitEdit,
  pendingByPath,
}: NestedExpandPopoverProps) {
  const { t } = useTranslation("document");
  const [open, setOpen] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const expansion = useMemo(() => getNestedExpansion(value), [value]);

  // Suppress trigger entirely when nothing to expand — caller (grid)
  // can still decide to render the bare sentinel without affordance.
  if (!expansion) return null;

  const startEdit = (path: string, initial: string) => {
    setEditingPath(path);
    setDraft(initial);
  };
  const cancelEdit = () => {
    setEditingPath(null);
    setDraft("");
  };
  const commitEdit = (override?: string | Record<string, unknown>) => {
    if (editingPath !== null) {
      onCommitEdit?.(editingPath, override !== undefined ? override : draft);
    }
    setEditingPath(null);
    setDraft("");
  };

  // Per-entry pending display accepts both a string and an EJSON wrapper.
  // A wrapper surfaces in user-friendly notation (ObjectId's hex, Date's
  // ISO, NumberDecimal's string, BinData's base64).
  const pendingDisplayText = (
    pending: string | Record<string, unknown>,
  ): string => {
    if (typeof pending === "string") return pending;
    const type = detectBsonType(pending);
    if (type === "objectId") return `ObjectId("${pending.$oid as string}")`;
    if (type === "date") {
      const d = pending.$date;
      return typeof d === "string"
        ? `ISODate("${d}")`
        : safeStringifyCell(pending);
    }
    if (type === "decimal128") {
      return `NumberDecimal("${pending.$numberDecimal as string}")`;
    }
    if (type === "binData") {
      const b = pending.$binary as Record<string, unknown>;
      return `BinData("${b.base64 as string}")`;
    }
    return safeStringifyCell(pending);
  };

  const containerLabel =
    expansion.containerKind === "array"
      ? t("nestedPopover.containerArray", { count: expansion.entries.length })
      : t("nestedPopover.containerObject", { count: expansion.entries.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("nestedPopover.expandAriaLabel", { fieldName })}
          aria-expanded={open}
          className="ml-1 inline-flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-80 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          role="region"
          aria-label={t("nestedPopover.regionAriaLabel", { fieldName })}
          className="flex flex-col"
        >
          <div className="border-b border-border bg-secondary px-2.5 py-1.5 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
            {fieldName} — {containerLabel}
          </div>
          {expansion.entries.length === 0 ? (
            <div className="px-2.5 py-2 text-xs italic text-muted-foreground">
              {t("nestedPopover.empty")}
            </div>
          ) : (
            <ul className="max-h-72 overflow-auto py-1 text-xs">
              {expansion.entries.map((entry) => {
                const path = entryPath(entry);
                const pendingValue = pendingByPath?.get(path);
                const hasPending = pendingValue !== undefined;
                const isEditing = editingPath === path;
                const canEdit = !entry.isNested && onCommitEdit !== undefined;
                // Decide whether this is a BSON wrapper (raw value OR
                // pending value is a wrapper). If either one is, use the
                // BsonTypeEditor.
                const bsonType =
                  detectBsonType(entry.value) ??
                  (typeof pendingValue === "object" && pendingValue !== null
                    ? detectBsonType(pendingValue)
                    : null);
                return (
                  <li
                    key={`${entry.kind}:${path}`}
                    className="flex items-baseline gap-2 px-2.5 py-1 hover:bg-muted"
                    data-testid="nested-entry"
                  >
                    <span className="shrink-0 font-mono text-3xs text-muted-foreground">
                      {entryLabel(entry)}
                    </span>
                    <span
                      className="flex-1 truncate"
                      title={entryValueText(entry)}
                    >
                      {isEditing && bsonType !== null ? (
                        <BsonTypeEditor
                          type={bsonType}
                          initialValue={
                            typeof pendingValue === "object" &&
                            pendingValue !== null
                              ? pendingValue
                              : entry.value
                          }
                          ariaLabel={t("nestedPopover.editingAriaLabel", {
                            fieldName,
                            path,
                          })}
                          onCommit={(wrapped) => commitEdit(wrapped)}
                          onCancel={cancelEdit}
                        />
                      ) : isEditing ? (
                        <input
                          type="text"
                          autoFocus
                          aria-label={t("nestedPopover.editingAriaLabel", {
                            fieldName,
                            path,
                          })}
                          className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none ring-1 ring-primary"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              commitEdit();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              e.stopPropagation();
                              cancelEdit();
                            }
                          }}
                          onBlur={() => commitEdit()}
                        />
                      ) : entry.isNested ? (
                        <span className="italic text-muted-foreground">
                          {entryValueText(entry)}
                        </span>
                      ) : hasPending ? (
                        <span
                          className="block truncate rounded bg-highlight/20 px-1"
                          data-testid="nested-pending"
                        >
                          {pendingDisplayText(pendingValue)}
                        </span>
                      ) : entry.value === null ? (
                        <span className="italic text-muted-foreground">
                          null
                        </span>
                      ) : (
                        entryValueText(entry)
                      )}
                    </span>
                    <span className="shrink-0 text-3xs text-muted-foreground">
                      {entryTypeLabel(entry)}
                    </span>
                    {canEdit && !isEditing && (
                      <button
                        type="button"
                        aria-label={t("nestedPopover.editAriaLabel", {
                          fieldName,
                          path,
                        })}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (bsonType !== null) {
                            // BsonTypeEditor manages its own draft state;
                            // we only need to switch to "editing" mode.
                            setEditingPath(path);
                            setDraft("");
                            return;
                          }
                          startEdit(
                            path,
                            hasPending && typeof pendingValue === "string"
                              ? pendingValue
                              : entry.value === null
                                ? ""
                                : String(entry.value),
                          );
                        }}
                      >
                        <Pencil size={10} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
