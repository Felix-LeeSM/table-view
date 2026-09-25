import { EditorView } from "@codemirror/view";

/**
 * Dark-mode token mapping and UX improvements for the CodeMirror autocomplete
 * popup.
 *
 * 2026-05-15 — token names corrected. The previous version referenced *raw*
 * CSS variables such as `var(--popover)` / `var(--primary)`, but this
 * project defines those tokens only with a prefix: `--tv-primary`
 * (themes.css) and `--color-primary` (Tailwind `@theme inline` in index.css).
 * A bare `--primary` was defined nowhere, so
 * `background-color: var(--primary)` fell through as invalid, and the active
 * item's highlight showed as a gray the user could barely notice. Every
 * reference now uses the raw `--tv-*` variables so the background change
 * actually applies.
 *
 * UX package (options 1, 2, 4, 5, 6 of
 * `docs/explorations/mongo-autocomplete-ux-2026-05-15.html`):
 *   - Option 1: a 3px accent bar on the left of the active item, reusing the
 *     `--tv-ring` token (focus ring).
 *   - Option 2: a key hint bar at the bottom of the popup (`↑↓ · ⏎/⇥ · Esc`).
 *   - Option 4: icon colour per completion `type`.
 *   - Option 5: `.cm-completionDetail` styling.
 *   - Option 6: token mapping for the `.cm-completionInfo` right-hand panel.
 *
 * SqlQueryEditor / MongoQueryEditor / RedisCommandEditor / SearchQueryEditor /
 * DocumentFilterBar / AddDocumentModal mount the same theme, so the popup tone
 * matches across paradigms.
 */
export const autocompleteTooltipTheme = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "var(--tv-popover)",
    color: "var(--tv-popover-foreground)",
    border: "1px solid var(--tv-border)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--tv-popover)",
    color: "var(--tv-popover-foreground)",
    border: "1px solid var(--tv-border)",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.18), 0 2px 4px rgba(0, 0, 0, 0.12)",
    overflow: "hidden",
    "&::after": {
      content: '"↑↓ navigate  ·  ⏎ / Tab accept  ·  Esc close"',
      display: "block",
      borderTop: "1px solid var(--tv-border)",
      padding: "4px 10px",
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: "10.5px",
      letterSpacing: "0.02em",
      color: "var(--tv-muted-foreground)",
      background: "var(--tv-popover)",
    },
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    maxHeight: "20em",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    color: "var(--tv-popover-foreground)",
    padding: "2px 6px",
    boxShadow: "inset 3px 0 0 transparent",
  },
  // Active item — `--tv-primary` resolves to a real colour (per theme, e.g.
  // #4f46e5 / #818cf8 / #0969da). It used to be the undefined `--primary`, so
  // the background did not change and there was almost no cue. `!important`
  // pins it for legibility so CodeMirror's default hover background does not
  // paint over the active item.
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--tv-primary) !important",
    color: "var(--tv-primary-foreground) !important",
    boxShadow: "inset 3px 0 0 var(--tv-ring)",
  },
  ".cm-completionLabel": { color: "inherit" },
  ".cm-completionMatchedText": {
    color: "inherit",
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: "var(--tv-muted-foreground)",
    fontStyle: "normal",
    marginLeft: "0.5em",
  },
  ".cm-completionIcon": {
    color: "var(--tv-muted-foreground)",
    opacity: "0.85",
    paddingRight: "0.4em",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon": {
    color: "var(--tv-primary-foreground)",
    opacity: "1",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "var(--tv-primary-foreground)",
    opacity: "0.85",
  },
  ".cm-completionIcon-function": { color: "#5fb3ff" },
  ".cm-completionIcon-class": { color: "#8de28d" },
  ".cm-completionIcon-keyword": { color: "#f0a85a" },
  ".cm-completionIcon-property": { color: "#ff9bd6" },
  ".cm-completionIcon-type": { color: "#c9a9ff" },
  ".cm-completionInfo": {
    backgroundColor: "var(--tv-popover)",
    color: "var(--tv-popover-foreground)",
    border: "1px solid var(--tv-border)",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.18), 0 2px 4px rgba(0, 0, 0, 0.12)",
    padding: "8px 10px",
    maxWidth: "320px",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: "12px",
    lineHeight: "1.5",
  },
  ".cm-completionInfo code": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: "11.5px",
    background: "rgba(127, 127, 127, 0.15)",
    padding: "1px 4px",
    borderRadius: "3px",
  },
});
