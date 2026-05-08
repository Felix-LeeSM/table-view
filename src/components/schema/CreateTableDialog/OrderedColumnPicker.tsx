import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

/**
 * `OrderedColumnPicker` — replaces the flat checkbox grid that
 * IndexesTabBody / ForeignKeysTabBody / CreateIndexModal used to render.
 *
 * The old UI only stored an ordered array (`columns: string[]`) but never
 * surfaced that order to the user — there was no way to tell which
 * column was first vs. second in the index / FK / UNIQUE constraint, and
 * the checkbox visual didn't communicate "this is an ordered list".
 *
 * The new UI splits the column set into two rows:
 *   - **Selected (top)**: pills in click order with `1. / 2. / …`
 *     index badges, ←/→ reorder buttons, and × remove button.
 *   - **Available (bottom)**: dashed-border `+ name` chips. Clicking
 *     appends to the selected list (preserving the click-order
 *     semantic the backend already relies on).
 *
 * Caller passes `available` (full set) and `selected` (current ordered
 * subset). The component computes the unselected diff itself; emit
 * `onChange(next)` with the new ordered array on every mutation.
 */

export interface OrderedColumnPickerProps {
  /** Full set of column names the picker may add from. */
  available: string[];
  /** Currently selected names, in user-chosen order. */
  selected: string[];
  /** Optional per-column label override (e.g. `"name (text)"`). */
  labelOf?: (name: string) => string;
  /** Called with the next ordered selection on every mutation. */
  onChange: (next: string[]) => void;
  /**
   * Used to scope `aria-label` for the buttons. E.g. `"Index column"`
   * yields `"Index column: email"` for the add button.
   */
  ariaLabelPrefix: string;
  /** Empty-state copy shown when `available` is empty. */
  emptyMessage?: string;
}

export default function OrderedColumnPicker({
  available,
  selected,
  labelOf,
  onChange,
  ariaLabelPrefix,
  emptyMessage = "No columns available",
}: OrderedColumnPickerProps) {
  if (available.length === 0) {
    return (
      <div
        className="rounded border border-dashed border-border bg-background p-3 text-center"
        aria-label={`${ariaLabelPrefix} picker`}
      >
        <span className="text-xs italic text-muted-foreground">
          {emptyMessage}
        </span>
      </div>
    );
  }

  const selectedSet = new Set(selected);
  const unselected = available.filter((c) => !selectedSet.has(c));
  const display = (name: string) => (labelOf ? labelOf(name) : name);

  const moveAt = (index: number, direction: -1 | 1) => {
    const next = [...selected];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const removeAt = (index: number) => {
    const next = selected.filter((_, i) => i !== index);
    onChange(next);
  };

  const addColumn = (name: string) => {
    if (selectedSet.has(name)) return;
    onChange([...selected, name]);
  };

  return (
    <div
      className="space-y-2 rounded border border-border bg-background p-2"
      aria-label={`${ariaLabelPrefix} picker`}
    >
      {/* Selected pills with order index + reorder + remove */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((name, i) => {
            const isFirst = i === 0;
            const isLast = i === selected.length - 1;
            return (
              <div
                key={name}
                className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 py-0.5 pl-1.5 pr-0.5 text-xs"
              >
                <span className="font-mono font-medium text-primary">
                  {i + 1}.
                </span>
                <span className="text-foreground">{display(name)}</span>
                <button
                  type="button"
                  onClick={() => moveAt(i, -1)}
                  disabled={isFirst}
                  aria-label={`Move ${ariaLabelPrefix} ${name} earlier`}
                  title="Move earlier"
                  className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveAt(i, 1)}
                  disabled={isLast}
                  aria-label={`Move ${ariaLabelPrefix} ${name} later`}
                  title="Move later"
                  className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove ${ariaLabelPrefix}: ${name}`}
                  title="Remove"
                  className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Available chips — click to append to selected. */}
      {unselected.length > 0 ? (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label={`Available ${ariaLabelPrefix} options`}
        >
          {unselected.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => addColumn(name)}
              aria-label={`${ariaLabelPrefix}: ${name}`}
              className="flex items-center gap-1 rounded border border-dashed border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-foreground"
            >
              <Plus className="size-3" />
              {display(name)}
            </button>
          ))}
        </div>
      ) : selected.length === 0 ? (
        <span className="text-xs italic text-muted-foreground">
          {emptyMessage}
        </span>
      ) : null}
    </div>
  );
}
