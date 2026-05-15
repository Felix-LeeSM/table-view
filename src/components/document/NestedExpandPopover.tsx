import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
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

export default function NestedExpandPopover({
  value,
  fieldName,
}: NestedExpandPopoverProps) {
  const [open, setOpen] = useState(false);
  const expansion = useMemo(() => getNestedExpansion(value), [value]);

  // Suppress trigger entirely when nothing to expand — caller (grid)
  // can still decide to render the bare sentinel without affordance.
  if (!expansion) return null;

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
                const k =
                  entry.kind === "object-entry" ? entry.key : `${entry.index}`;
                return (
                  <li
                    key={`${entry.kind}:${k}`}
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
                      {entry.isNested ? (
                        <span className="italic text-muted-foreground">
                          {entryValueText(entry)}
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
