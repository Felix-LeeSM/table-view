// Wave 9.5 회귀 3 — 모든 테마가 slate 로 고정되는 cascade 역전 (2026-05-16).
//
// 회귀 원인:
//   wave 9.5 commit `1d8e230` 의 첫 부팅 빈 테마 fix 가 index.css 에
//   `:root[data-mode="light"] { --tv-* }` / `:root[data-mode="dark"] { --tv-* }`
//   블록을 base fallback 으로 추가했다. 의도는 "theme block 보다 낮은
//   specificity 의 fallback" — 작성자는 `:root[data-mode]` specificity 를
//   (0,1,1) 로 계산하고 `[data-theme="X"][data-mode="Y"]` (0,2,0) 보다 약하다고
//   판단했다.
//
//   실제 specificity:
//     `:root[data-mode="X"]`          → (0, 2, 0)   ← :root 는 pseudo-class
//     `[data-theme="X"][data-mode="Y"]` → (0, 2, 0)
//   **동일**. 동일 specificity 이면 cascade order 가 승부. index.css 가
//   `@import "./themes.css"` 를 line 9 에 두고 fallback 블록을 line 99+ 에
//   두기 때문에 **fallback 이 themes.css 의 모든 per-theme override 를 덮어쓴다**.
//   결과: data-theme 가 무엇이든 slate 색깔이 강제.
//
// Fix 방향: fallback 을 `:where(:root[data-mode="X"])` 로 감싸 specificity 를
//   (0, 0, 0) 로 만든다. 모든 [data-theme] override 는 (0,2,0) 이므로 cascade
//   에서 무조건 이기고, fallback 은 data-theme 자체가 누락 / unknown 일 때만
//   발동한다 (theme-agnostic baseline 원래 의도 유지).
//
// 텍스트 단언 이유: themes.test.ts (Sprint 253) 와 동일 — jsdom 의 CSS
//   engine 은 custom-property cascade 를 신뢰성 있게 풀지 않아
//   `getComputedStyle` 로 cascade 결과를 검증할 수 없다. 정의 자체가
//   contract 이므로 정의 텍스트를 검증한다.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const indexCss = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

describe("index.css — Wave 9.5 theme fallback cascade (회귀 3, 2026-05-16)", () => {
  it("loads index.css contents (sanity)", () => {
    expect(indexCss.length).toBeGreaterThan(500);
  });

  // 회귀 가드 — raw `:root[data-mode="X"] {` 블록은 specificity (0,2,0) 이
  // 되어 themes.css 의 per-theme override 와 동률. cascade order 로 덮어쓰는
  // 회귀 발생 → 절대 raw 형태 금지.
  it("does NOT define raw `:root[data-mode='light'] { --tv-* }` block (cascade trap)", () => {
    // `:root[data-mode="light"] {` 가 single-line block opener 로 나오면 fail.
    // `:where(:root[data-mode="light"])` 안에 있으면 OK.
    expect(indexCss).not.toMatch(/^:root\[data-mode="light"\]\s*\{/m);
  });

  it("does NOT define raw `:root[data-mode='dark'] { --tv-* }` block (cascade trap)", () => {
    expect(indexCss).not.toMatch(/^:root\[data-mode="dark"\]\s*\{/m);
  });

  // 양성 — fallback 은 `:where()` 안에 있어 specificity 0. themes.css
  // 의 `[data-theme="X"][data-mode="Y"]` override (specificity 0,2,0) 가
  // cascade 에서 항상 이긴다.
  it("wraps the light-mode fallback in :where() to neutralize specificity", () => {
    expect(indexCss).toMatch(/:where\(:root\[data-mode="light"\]\)/);
  });

  it("wraps the dark-mode fallback in :where() to neutralize specificity", () => {
    expect(indexCss).toMatch(/:where\(:root\[data-mode="dark"\]\)/);
  });

  // fallback 의 의미 (theme-agnostic baseline) 자체는 보존돼야 한다 — slate
  // primary 색이 light/dark 모두 정의되어 있는지 sanity check.
  it("preserves the slate light-mode `--tv-primary` baseline value (#4f46e5)", () => {
    expect(indexCss).toMatch(/--tv-primary:\s*#4f46e5/);
  });

  it("preserves the slate dark-mode `--tv-primary` baseline value (#818cf8)", () => {
    expect(indexCss).toMatch(/--tv-primary:\s*#818cf8/);
  });
});
