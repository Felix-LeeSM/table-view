// Issue #1734 (3) — the one class both data grids paint on a selected row.
//
// It lives here rather than in each grid because the two paradigms used to draw
// the same state differently (`bg-accent/20` in the RDB `DataRow`,
// `bg-accent dark:bg-accent/60` in `DocumentGridRows`) and only one of the two
// was ever measured. A single export makes a one-sided change impossible.

/**
 * Selected-row fill.
 *
 * Why `foreground` and not a hue: the fill must stay visible in all 162
 * `[data-theme][data-mode]` blocks of `src/themes.css`, and no hue token in the
 * palette has a guaranteed luminance direction there. `--tv-primary` is a
 * near-white yellow in the clickhouse / miro / binance / voltagent / renault
 * light themes, where a 15% tint measures 1.015–1.095 against the row
 * background — as invisible as the `accent` fill the owner rejected.
 * `--tv-foreground` is the body-text pair of `--tv-background`, so it contrasts
 * by construction and always moves the row the right way (darker in light mode,
 * lighter in dark).
 *
 * The alpha is the smallest one whose worst theme still clears the floor with
 * room to spare. Every number above and the floor itself are asserted, per
 * theme and mode, by `DataGridTable.selection-contrast.test.tsx` — run that file
 * to reproduce them.
 *
 * Channels this has to stay distinct from: `hover:bg-muted` (hover),
 * `shadow-[inset_2px_0_0_0_var(--color-ring)]` (roving-anchor row), and
 * `bg-primary/10` + `INLINE_EDIT_CELL_RING` (the editing cell, which stacks on
 * top of this fill).
 */
export const SELECTED_ROW_FILL = "bg-foreground/12";
