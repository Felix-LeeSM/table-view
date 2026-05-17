import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompleteTooltipTheme } from "./autocompleteTheme";

// Sprint 303 (2026-05-14) — autocomplete popup 의 다크모드 토큰 매핑 가드.
// CodeMirror 의 default `tooltips.baseTheme` 는 light 색을 직접 박아 다크
// 모드에서 흰 배경 + 흰 글씨로 가독성 0 이 됐다 (2026-05-14 user 보고).
// 이 가드는 우리가 inject 한 theme extension 이 popup 의 핵심 surface
// (tooltip wrapper / list item / selected state / matched-text) 에
// design-token 으로 매핑된 style 을 *주입* 한다는 사실을 확인한다.
// 실제 token 의 light/dark 값은 themes.css 에 있고, 우리는 token 이름이
// 정확히 들어갔는지만 검사 — JSDOM 은 CSS variable 을 resolve 하지 않아
// computedStyle 의 var 까지만 본다.
//
// ADR 0031 (2026-05-15) — raw `--primary` / `--popover` 는 어디에도 정의돼
// 있지 않았다. 이 프로젝트의 token surface 는 `--tv-*` (themes.css) 와
// `--color-*` (index.css Tailwind `@theme inline`) 둘 뿐. autocompleteTheme
// 이 ADR 0031 시점에 `--tv-*` 로 교정됐고, 본 테스트는 *해당 prefix 가 실제
// 로 emit 됨* 을 lock 한다. 다시 raw var 로 회귀하면 즉시 실패.

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
