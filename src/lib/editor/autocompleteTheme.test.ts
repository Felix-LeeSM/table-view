import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { autocompleteTooltipTheme } from "./autocompleteTheme";

// Guard for the autocomplete popup's dark-mode token mapping (2026-05-14).
// CodeMirror's default `tooltips.baseTheme` hard-codes light colours, so in
// dark mode the popup showed white text on a white background and could not
// be read (user report, 2026-05-14). This guard checks that the theme
// extension we inject *injects* design-token-mapped styles into the popup's
// core surfaces (tooltip wrapper / list item / selected state / matched-text).
// The tokens' actual light/dark values live in themes.css; this test only
// checks that the token names went in correctly — JSDOM does not resolve CSS
// variables, so a computed style shows no more than the `var(...)`.
//
// ADR 0031 (2026-05-15) — raw `--primary` / `--popover` were not defined
// anywhere; see the `autocompleteTooltipTheme` TSDoc in
// `src/lib/editor/autocompleteTheme.ts`. This test locks that the `--tv-*`
// prefix is actually emitted, so a regression to raw vars fails immediately.

describe("autocompleteTooltipTheme", () => {
  it("emits styles for the popup tooltip wrapper", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [autocompleteTooltipTheme],
      }),
    });
    const styleText = collectStyleText();
    expect(styleText).toContain(".cm-tooltip");
    expect(styleText).toMatch(/var\(--tv-popover\)/);
    expect(styleText).toMatch(/var\(--tv-popover-foreground\)/);
    view.destroy();
  });

  it("targets the selected list item with primary token", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [autocompleteTooltipTheme],
      }),
    });
    const styleText = collectStyleText();
    expect(styleText).toContain("aria-selected");
    expect(styleText).toMatch(/var\(--tv-primary\)/);
    expect(styleText).toMatch(/var\(--tv-primary-foreground\)/);
    view.destroy();
  });

  it("emphasises the matched text segment", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [autocompleteTooltipTheme],
      }),
    });
    const styleText = collectStyleText();
    expect(styleText).toContain(".cm-completionMatchedText");
    // bold weight is the only visual signal in our theme — the colour
    // stays inherited so the selected highlight tone wins.
    expect(styleText).toMatch(/font-weight:\s*600/);
    view.destroy();
  });
});

/**
 * CodeMirror appends a `<style>` element to the document head for each
 * theme rule. Collect every style sheet text so assertions can grep
 * verbatim. Cheap enough to run per test.
 */
function collectStyleText(): string {
  const styles = document.head.querySelectorAll("style");
  const all: string[] = [];
  styles.forEach((s) => {
    if (s.textContent) all.push(s.textContent);
  });
  return all.join("\n");
}
