import { useMemo, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { safeStringifyCell } from "@lib/jsonCell";
import {
  getNestedExpansion,
  type NestedEntry,
} from "@lib/document/nestedExpansion";

/**
 * Sprint 321 — Slice F.1: sentinel cell 의 1-depth 내용을 popover 로
 * 빠르게 inspect. Edit 흐름은 Sprint 322 (F.2) 가 도입한다.
 *
 * Invariants:
 * - trigger 클릭은 row selection 으로 propagate 되지 않는다 (popover
 *   본체의 stopPropagation). 사용자가 inspect 만 의도해도 selection
 *   토글 부작용 없음.
 * - nested-of-nested entry 는 sentinel 표기로 유지. 깊은 inspect 는
 *   Quick Look 패널.
 */

interface NestedExpandPopoverProps {
  /**
   * Raw nested value (object 또는 array). `raw_documents` 의 cell 또는
   * 그 자식. sentinel string 은 caller 가 raw 로 swap 후 전달.
   */
  value: unknown;
  /** 사용자가 inspect 중인 field name (object key) 또는 column name. */
  fieldName: string;
  /**
   * Sprint 322 — Slice F.2: scalar entry 의 인라인 edit commit
   * callback. 미제공 시 popover 는 read-only (Sprint 321 F.1
   * 동작). path 는 dot-notation (object → `"key"`, array → `"0"`,
   * 깊은 entry → `"key.subkey"`). value 는 사용자가 입력한 문자열을
   * 1차 raw 로 전달 — 캐스팅은 호출자 책임 (Slice G BSON editor 가
   * 별도 처리).
   */
  onCommitEdit?: (path: string, value: string) => void;
  /**
   * 현재 path 의 pending value (있다면). 표시 시 시각 cue 와 input
   * 의 초기값으로 사용.
   */
  pendingByPath?: ReadonlyMap<string, string>;
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
  const commitEdit = () => {
    if (editingPath !== null) {
      onCommitEdit?.(editingPath, draft);
    }
    setEditingPath(null);
    setDraft("");
  };

  const containerLabel =
    expansion.containerKind === "array"
      ? `array (${expansion.entries.length} items)`
      : `object (${expansion.entries.length} fields)`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Expand nested ${fieldName}`}
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
          aria-label={`Nested fields for ${fieldName}`}
          className="flex flex-col"
        >
          <div className="border-b border-border bg-secondary px-2.5 py-1.5 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
            {fieldName} — {containerLabel}
          </div>
          {expansion.entries.length === 0 ? (
            <div className="px-2.5 py-2 text-xs italic text-muted-foreground">
              empty
            </div>
          ) : (
            <ul className="max-h-72 overflow-auto py-1 text-xs">
              {expansion.entries.map((entry) => {
                const path = entryPath(entry);
                const pendingValue = pendingByPath?.get(path);
                const hasPending = pendingValue !== undefined;
                const isEditing = editingPath === path;
                const canEdit = !entry.isNested && onCommitEdit !== undefined;
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
                      {isEditing ? (
                        <input
                          type="text"
                          autoFocus
                          aria-label={`Editing ${fieldName}.${path}`}
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
                          {pendingValue}
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
                        aria-label={`Edit ${fieldName}.${path}`}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(
                            path,
                            hasPending
                              ? pendingValue!
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
