// Sprint 310 (2026-05-14) — Phase 28 Slice A4 snippet engine.
//
// Thin wrapper around `@codemirror/autocomplete`'s `snippet()` API. The
// `+ Insert ▾` popover passes a template using our user-facing
// `<placeholder>` syntax (decision D-06); this module converts it to
// CodeMirror's native `${placeholder}` syntax and drives the editor.
//
// Tab/Shift+Tab/Esc placeholder navigation is the responsibility of
// CodeMirror's built-in `snippetKeymap` (decision D-07). The Mongo editor
// already mounts `autocompletion()` which transitively activates that
// keymap, so callers don't have to wire anything extra.

import type { EditorView } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";

/**
 * Convert our user-facing `<name>` placeholder markers into CodeMirror's
 * `${name}` snippet syntax. Names are restricted to `[A-Za-z0-9_]+` so
 * malformed `<…>` content with whitespace or punctuation passes through
 * verbatim (avoids false positives on user-typed comparisons like
 * `a < b > c`).
 *
 * Exported for unit testing.
 */
export function convertPlaceholders(template: string): string {
  return template.replace(/<([A-Za-z0-9_]+)>/g, "${$1}");
}

/**
 * Insert a `<placeholder>`-flavoured template at the current cursor
 * position of `view`. Returns nothing — side-effect only. After
 * insertion the editor's selection sits on the first placeholder so the
 * user can immediately type to overwrite it. Tab/Shift+Tab/Esc are
 * handled by CodeMirror's native snippet keymap.
 */
export function insertMongoshSnippet(view: EditorView, template: string): void {
  const cmTemplate = convertPlaceholders(template);
  const { from, to } = view.state.selection.main;
  snippet(cmTemplate)(view, null, from, to);
}
