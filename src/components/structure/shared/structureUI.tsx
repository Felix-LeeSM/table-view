import type { ReactNode } from "react";

/**
 * Structure sub-tab UI primitives.
 *
 * Collects the shared outer chrome (shell + action bar + empty state) used
 * by all 4 sub-tabs: Columns / Indexes / Constraints / Triggers. Rows and
 * cells are deliberately not componentized — their patterns vary too much
 * (icon prefix, FK color, badge, monospace, …) — so className constants are
 * exported instead: the JSX stays light while styling stays in sync.
 *
 * Per the P1 decision, the Triggers card body keeps its own markup and only
 * Shell/ActionBar/Empty are shared.
 */

export interface StructureShellProps {
  children: ReactNode;
}

/**
 * Outer container for the 4 sub-tabs. `flex flex-1 flex-col overflow-hidden`
 * makes the sub-tab content fill the parent panel's remaining height and
 * scroll only inside.
 */
export function StructureShell({ children }: StructureShellProps) {
  return <div className="flex flex-1 flex-col overflow-hidden">{children}</div>;
}

export interface StructureActionBarProps {
  /**
   * Count / status label shown on the left. `null` keeps the bar
   * right-aligned only. Per the Q1 decision every sub-tab exposes a count
   * (`5 columns`, `3 triggers`).
   */
  count?: ReactNode;
  /** Right-side actions (usually a + button plus secondary actions). */
  actions: ReactNode;
}

/**
 * Sub-tab header bar. `justify-between` with a count, `justify-end` without.
 * Identical look across the 4 sub-tabs — same color as the sticky table
 * head (`bg-secondary`).
 */
export function StructureActionBar({
  count,
  actions,
}: StructureActionBarProps) {
  return (
    <div
      className={
        count !== undefined && count !== null
          ? "flex items-center justify-between border-b border-border bg-secondary px-2 py-1"
          : "flex items-center justify-end border-b border-border bg-secondary px-2 py-1"
      }
    >
      {count !== undefined && count !== null && (
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {count}
        </span>
      )}
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

export interface StructureEmptyProps {
  /** Short body text, e.g. "No columns found". */
  children: ReactNode;
}

/**
 * Italic placeholder shown when a sub-tab body is empty. Unified across the
 * 4 sub-tabs. `flex-1 items-center justify-center` centers it in the
 * remaining space.
 */
export function StructureEmpty({ children }: StructureEmptyProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm italic text-muted-foreground">
      {children}
    </div>
  );
}

export interface StructureTableProps {
  /**
   * Some sub-tabs (Columns) use a fixed layout to stabilize column widths.
   * The default is auto layout.
   */
  fixed?: boolean;
  children: ReactNode;
}

/**
 * Sub-tab table wrapper. Overflow scroll + a shared baseline style. Callers
 * build thead / tbody themselves from the STRUCTURE_TH / STRUCTURE_TD tokens.
 */
export function StructureTable({ fixed, children }: StructureTableProps) {
  return (
    <div className="flex-1 overflow-auto">
      <table
        className={
          fixed
            ? "w-full table-fixed border-collapse text-sm"
            : "w-full border-collapse text-sm"
        }
      >
        {children}
      </table>
    </div>
  );
}

// ── className tokens ──────────────────────────────────────────────────────
//
// Row/cell patterns vary too much to extract into components, so only the
// tokens are shared. All 4 editors import the same className constants and
// use them inline — TS / the IDE guarantee a single source of truth while
// avoiding an explosion of extra props.
//
// The unified row height is `h-8` (32px). The old tr/td carried only `py-1`,
// so height varied with content (button cells collapsed when hovering an
// empty state), and cells baseline-aligned visually because vertical-align
// was unspecified. These tokens fix both defects with `h-8` +
// `align-middle`.

/** Sticky table head wrapper — apply directly to `<thead>`. */
export const STRUCTURE_THEAD = "sticky top-0 z-10 bg-secondary";

/** `<th>` for a regular column. */
export const STRUCTURE_TH =
  "h-8 border-b border-r border-border px-3 py-1.5 text-left align-middle text-xs font-medium text-secondary-foreground";

/** `<th>` for the right-side actions column (fixed width, centered). */
export const STRUCTURE_TH_ACTIONS =
  "h-8 w-20 border-b border-border px-1 py-1.5 text-center align-middle text-xs font-medium text-secondary-foreground";

/** Data row `<tr>` — group hover reveals the actions button. */
export const STRUCTURE_TR = "group h-8 border-b border-border hover:bg-muted";

/**
 * Regular data `<td>`. Callers compose extra text-color / mono / max-w
 * tokens on top. On table cells `h-8` carries minimum-height semantics per
 * CSS 2.2 §17.5.3 — when the content is taller (ColumnsEditor editing adds
 * a USING/warning input via `flex-col`) the cell/row grows with it, while a
 * static row keeps the 32px floor. `min-height` is undefined on table-cell
 * (some webviews ignore it), hence `h-8`.
 */
export const STRUCTURE_TD =
  "h-8 border-r border-border px-3 py-1 align-middle text-xs text-foreground";

/** Right-side actions `<td>`. */
export const STRUCTURE_TD_ACTIONS =
  "h-8 w-20 border-l border-border px-1 py-1 text-center align-middle";
