import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@components/ui/popover";
import { filterPostgresTypes } from "@/lib/sql/postgresTypes";
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
 * Design notes:
 * - Stays in `src/components/schema/` (no anticipatory abstraction) per
 *   Sprint 227 spec — the second consumer (ALTER-TABLE column-add)
 *   is not in scope yet.
 * - No coloring / pill rendering (deferred to Sprint 230 polish).
 * - The popover stays open while the user types; clicking a suggestion
 *   commits + closes; pressing Enter on a highlighted suggestion
 *   commits + closes; pressing Esc closes without committing; blur
 *   commits the current raw input verbatim (so free-text strings like
 *   `numeric(10,4)` survive).
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

  const suggestions = useMemo(() => filterPostgresTypes(value), [value]);

  // Reset the highlighted suggestion when the filtered list shrinks
  // (e.g. the user typed a longer prefix). Without this the highlight
  // index could overshoot the new list length.
  useEffect(() => {
    if (highlight >= suggestions.length) {
      setHighlight(0);
    }
  }, [highlight, suggestions.length]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    setHighlight(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!open) {
        setOpen(true);
        return;
      }
      e.preventDefault();
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
    <Popover open={open && suggestions.length > 0} onOpenChange={setOpen}>
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
          <ChevronDown
            className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={2}
        className="w-(--radix-popover-trigger-width) max-h-48 overflow-auto p-1"
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
    </Popover>
  );
}
