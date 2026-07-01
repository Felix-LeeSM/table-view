import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@components/ui/popover";
import {
  expandParametricDefault,
  filterPostgresTypes,
  filterPostgresTypesAgainst,
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
  /**
   * Sprint 230 — optional dynamic type source. When supplied, the
   * combobox filters from this list (typically the merged
   * canonical + live PG types from `usePostgresTypes`); when omitted,
   * the combobox falls back to the canonical
   * `POSTGRES_COMMON_TYPES` list (Sprint 227 baseline). Default is
   * `undefined` so existing tests / non-DB consumers stay
   * byte-equivalent.
   */
  typesSource?: readonly string[];
  /**
   * Sprint 234 — optional `display label → type_kind` lookup. When
   * supplied, each option in the suggestion popover renders a small
   * color dot prefix:
   *   `"base"`     → no dot (default — wrapper omitted entirely)
   *   `"enum"`     → blue dot   (`text-typekind-enum`)
   *   `"domain"`   → green dot  (`text-typekind-domain`)
   *   `"range"`    → purple dot (`text-typekind-range`)
   *   `"composite"`→ orange dot (`text-typekind-composite`)
   *   any other kind → no dot (graceful degrade — never throws)
   *
   * The accessible name (option text content) stays the verbatim type
   * label — color dots are `<span aria-hidden>•</span>` so screen
   * readers see only the type name. Lookup is case-sensitive on the
   * display label string. When `typeKindMap` is omitted, the combobox
   * renders identically to Sprint 230 (back-compat).
   */
  typeKindMap?: ReadonlyMap<string, string>;
}

/**
 * Sprint 234 — map a `type_kind` string to the Tailwind color class for
 * the option's color dot. Returns `null` for `"base"` and any unknown
 * kind so the dot wrapper is omitted entirely (no DOM noise, no
 * spurious icon for built-ins). The closed switch matches the four
 * colored kinds enumerated in `PostgresTypeInfo` (Sprint 230); a future
 * PG kind (e.g. multirange `'m'`) automatically degrades to no dot.
 */
function colorClassForTypeKind(kind: string | undefined): string | null {
  switch (kind) {
    case "enum":
      return "text-typekind-enum";
    case "domain":
      return "text-typekind-domain";
    case "range":
      return "text-typekind-range";
    case "composite":
      return "text-typekind-composite";
    default:
      return null;
  }
}

export default function CreateTableTypeCombobox({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
  typesSource,
  typeKindMap,
}: CreateTableTypeComboboxProps) {
  const { t } = useTranslation("schemaDialogs");
  const resolvedAriaLabel = ariaLabel ?? t("typeCombobox.defaultAriaLabel");
  const resolvedPlaceholder =
    placeholder ?? t("typeCombobox.defaultPlaceholder");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);
  // Caret target set when committing a parametric default — applied in
  // an effect after the value prop round-trips from the parent so the
  // selection survives React's controlled-input re-render.
  const pendingCaretRef = useRef<number | null>(null);

  const suggestions = useMemo(
    () =>
      typesSource
        ? filterPostgresTypesAgainst(typesSource, value)
        : filterPostgresTypes(value),
    [typesSource, value],
  );

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

  // Keep the highlighted option in view when the user navigates with
  // ↑/↓. Without this the popover scrolls only on hover, so keyboard
  // users below the visible window stay invisible.
  useEffect(() => {
    if (!open) return;
    const list = listboxRef.current;
    if (!list) return;
    const target = list.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    target?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

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
            aria-label={resolvedAriaLabel}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="create-table-type-combobox-listbox"
            placeholder={resolvedPlaceholder}
            role="combobox"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("typeCombobox.showTypesAria")}
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
          // No flip, no auto-shrink — fixed 240px box with internal
          // scroll. Sprint 227 hot-fix used radix's available-height
          // var which jumped/clipped near the viewport edge. Force-
          // inline scroll on BOTH the radix content node and the
          // listbox `<ul>` so a cn-merge or hot-reload glitch on one
          // layer can't strip the scroll. `onWheel.stopPropagation()`
          // keeps the parent Dialog from swallowing wheel events.
          avoidCollisions={false}
          className="z-[60] w-[var(--radix-popover-trigger-width)] p-0"
          style={{ maxHeight: 240, overflowY: "auto" }}
          // Keep focus on the input so keyboard nav (↑/↓ Enter Esc)
          // continues to drive the popover. Without this, opening the
          // popover steals focus into the content body.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onWheel={(e) => e.stopPropagation()}
        >
          <ul
            ref={listboxRef}
            id="create-table-type-combobox-listbox"
            role="listbox"
            aria-label={t("typeCombobox.listboxAria")}
            className="flex flex-col gap-0.5 p-1"
            style={{ maxHeight: 240, overflowY: "auto" }}
          >
            {suggestions.map((t, idx) => {
              // Sprint 234 — color-dot prefix (only when typeKindMap is
              // supplied AND the lookup yields a colored kind). The dot
              // wrapper is omitted entirely for `"base"` / unknown
              // kinds so screen readers see only the type name.
              const dotColor = colorClassForTypeKind(typeKindMap?.get(t));
              return (
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
                    {dotColor ? (
                      <span
                        aria-hidden="true"
                        data-testid="type-kind-dot"
                        className={cn("mr-1", dotColor)}
                      >
                        •
                      </span>
                    ) : null}
                    {t}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      )}
    </Popover>
  );
}
