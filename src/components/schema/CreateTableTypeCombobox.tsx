import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@components/ui/popover";
import {
  expandParametricDefault,
  filterPostgresTypes,
  PARAMETRIC_TYPE_DEFAULTS,
} from "@/lib/sql/postgresTypes";
import { cn } from "@/lib/utils";

/**
 * Sprint 227 — `CreateTableTypeCombobox`. Filterable type picker for
 * the column-row repeater in `CreateTableDialog`. Uses the existing
 * `Popover` primitive (anchored to the input) + a manual filtered list
 * rendered inside the popover content; the list is keyboard-navigable
 * (↑/↓ to move, Enter to commit, Esc to close) and supports free-text
 * fallback — typing `numeric(10,4)` and committing on blur forwards
 * the raw input verbatim to `onChange`.
 *
 * Sprint 227 hot-fix (2026-05-07):
 * - chevron is now clickable (toggles popover, focuses input).
 * - popover opens on focus / click *and* on a fresh first-render mount
 *   into a focused row (mouse-click on the input still triggers it).
 * - popover content uses radix collision-aware max-height so it never
 *   gets clipped at the modal/viewport edge.
 * - selecting a bare parametric type (`varchar`, `char`, `numeric`)
 *   auto-expands to its canonical default (`varchar(255)` etc.) and
 *   places the caret between the parens for fast editing.
 */

export interface CreateTableTypeComboboxProps {
  value: string;
  onChange: (next: string) => void;
  /** Forwarded to the underlying `<input>` for accessibility. */
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}

export default function CreateTableTypeCombobox({
  value,
  onChange,
  ariaLabel = "Column data type",
  placeholder = "varchar(255)",
  className,
}: CreateTableTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Caret target set when committing a parametric default — applied in
  // an effect after the value prop round-trips from the parent so the
  // selection survives React's controlled-input re-render.
  const pendingCaretRef = useRef<number | null>(null);

  const suggestions = useMemo(() => filterPostgresTypes(value), [value]);

  // Reset the highlighted suggestion when the filtered list shrinks
  // (e.g. the user typed a longer prefix). Without this the highlight
  // index could overshoot the new list length.
  useEffect(() => {
    if (highlight >= suggestions.length) {
      setHighlight(0);
    }
  }, [highlight, suggestions.length]);

  // Apply pending caret position once the parent re-renders with the
  // expanded value (e.g. `varchar` → `varchar(255)` lands the caret
  // between the parens).
  useEffect(() => {
    if (pendingCaretRef.current !== null && inputRef.current) {
      const caret = pendingCaretRef.current;
      pendingCaretRef.current = null;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(caret, caret);
    }
  }, [value]);

  const commit = (raw: string) => {
    const expanded = expandParametricDefault(raw);
    if (expanded !== raw && raw in PARAMETRIC_TYPE_DEFAULTS) {
      // Place caret between parens: "varchar(255)" → caret at index 8.
      const parenIdx = expanded.indexOf("(");
      pendingCaretRef.current = parenIdx >= 0 ? parenIdx + 1 : expanded.length;
      // Keep popover open for a moment so the user sees the expansion;
      // close on the next tick via setOpen(false) to avoid jarring UX.
    }
    onChange(expanded);
    setOpen(false);
    setHighlight(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      if (open && suggestions[highlight] !== undefined) {
        e.preventDefault();
        commit(suggestions[highlight]!);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative flex", className)}>
          <input
            ref={inputRef}
            className={cn(
              "w-full rounded border border-border bg-background px-2 py-1 pr-6 text-xs text-foreground outline-none focus:border-primary",
            )}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => {
              // Blur commits the raw input verbatim (free-text
              // fallback for `numeric(10,4)` etc.). The popover
              // closes via the onOpenChange path; we don't override
              // the value here because `onChange` already mirrors
              // every keystroke into the parent state.
              setOpen(false);
            }}
            onKeyDown={handleKeyDown}
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="create-table-type-combobox-listbox"
            placeholder={placeholder}
            role="combobox"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Show types"
            // mousedown rather than click — fires before the input's
            // blur so we can flip `open` without the blur stealing it.
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className="size-3" aria-hidden="true" />
          </button>
        </div>
      </PopoverAnchor>
      {suggestions.length > 0 && (
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={2}
          // Force-bottom placement (no flip) + a fixed max-height with
          // internal scroll. Earlier Sprint 227 hot-fix used
          // `--radix-popover-content-available-height` which let radix
          // shrink the dropdown when the modal sat near the viewport
          // edge — yielding a clipped, jumpy list. Fixed 240px + scroll
          // is far less surprising and matches DataGrip behaviour.
          avoidCollisions={false}
          className="z-[60] max-h-60 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
          // Keep focus on the input so keyboard nav (↑/↓ Enter Esc)
          // continues to drive the popover. Without this, opening the
          // popover steals focus into the content body.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ul
            id="create-table-type-combobox-listbox"
            role="listbox"
            aria-label="PostgreSQL types"
            className="flex flex-col gap-0.5"
          >
            {suggestions.map((t, idx) => (
              <li key={t}>
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === highlight}
                  className={cn(
                    "w-full cursor-pointer rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted",
                    idx === highlight ? "bg-muted" : null,
                  )}
                  // Pointer down (instead of click) so the input doesn't
                  // blur-and-commit-then-clobber the click.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(t);
                  }}
                  onMouseEnter={() => setHighlight(idx)}
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      )}
    </Popover>
  );
}
