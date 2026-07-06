import type { EditorView } from "@codemirror/view";

/**
 * #1142 — CodeMirror 6 exposes no facet for setting attributes on the
 * `.cm-gutters` DOM (neither `lineNumbers()`/`gutter()` config nor
 * `EditorView.editorAttributes`/`contentAttributes` reach it), so the
 * line-number column is announced to screen readers as a stray column of
 * digits. That column is purely decorative — the editable text already lives
 * on `.cm-content` — so hide the gutters from the a11y tree.
 *
 * CM6 builds the `.cm-gutters` wrapper once per editor and reuses it for the
 * editor's whole lifetime (only the line-number markers inside it are
 * re-rendered), so a single `setAttribute` at mount is sufficient — no
 * MutationObserver needed. Call this right after `new EditorView(...)`.
 */
export function hideGutterFromA11y(view: EditorView): void {
  view.dom.querySelector(".cm-gutters")?.setAttribute("aria-hidden", "true");
}
