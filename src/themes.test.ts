// Sprint 253 (AC-253-01, AC-253-02) — Token foundation guard.
//
// ADR 0023 의 5-sprint chain (253→255→254→256→257) 의 foundation. Sprint
// 256 의 Chrome H (top stripe + prod border) 와 ConfirmDestructiveDialog
// 헤더 token 정렬 / Sprint 254 의 severity classifier color matrix 가
// 모두 본 6 env-specific 토큰 + `--tv-warning` 깊이 조정에 의존하므로,
// 본 테스트는 토큰 정의의 *유일한 source of truth* (`src/themes.css`)
// 를 텍스트 수준에서 검증한다.
//
// 왜 텍스트 검증인가: getComputedStyle 은 jsdom 에서 CSS variable
// inheritance 를 신뢰성 있게 풀지 않는다 (jsdom 의 CSS engine 이
// custom property cascade 를 부분만 구현). 토큰 정의는 css 파일에
// 들어 있는 *문자열* 자체가 contract 이므로, regex 매칭으로 정의
// 존재 + 값 정확성 + status-connecting amber 보존을 동시에 단언한다.
//
// 왜 fs.readFileSync (`require` 우회) 인가: Vite 6 의 css 플러그인은
// `import x from "*.css?raw"` 와 `import.meta.glob("*.css", {query:"?raw"})`
// 를 모두 가로채 default = "" 로 stub 한다 (CSS side-effect 처리). 그래서
// 본 sprint 의 token 검증은 vite 의 모듈 그래프를 우회해 직접 fs 로
// css 파일을 읽는다. `@types/node` 가 dev-dep 으로 명시 안 돼 있어
// `import` 가 type 에러 → `eval`-free runtime require + `// @ts-expect-error`
// 로 노드 모듈을 안전하게 끌어온다 (vitest = node runtime).
//
// 작성 일자: 2026-05-09 (Sprint 253, /tdd 흐름)

import { describe, it, expect } from "vitest";

// @ts-expect-error — node:fs is the canonical Node module. Vitest runs in
// Node so the import resolves at runtime; @types/node is not declared as
// a direct dep, hence the suppression.
import { readFileSync } from "node:fs";
// @ts-expect-error — see above for rationale.
import { resolve } from "node:path";

// process.cwd() at vitest invocation = repo root (where vite.config.ts
// lives). `src/themes.css` is the canonical SoT path for theme tokens.
// @ts-expect-error — process is a Node global; no @types/node import.
const themes = readFileSync(resolve(process.cwd(), "src/themes.css"), "utf-8");

describe("themes.css — Sprint 253 token foundation (AC-253-01, AC-253-02)", () => {
  // Sanity — fs reached the file. If this fails the path resolution is
  // wrong and every other expectation below is moot.
  it("loads themes.css contents (sanity)", () => {
    expect(themes.length).toBeGreaterThan(1000);
  });

  // AC-253-01 — 6 env-specific 토큰이 universal scope (theme-independent)
  // 에 정의된다. 정의 위치는 :root 또는 globally-applied selector 어디든
  // 가능하며, 모든 72 theme variant 가 inherit 가능해야 한다.
  it("defines --tv-env-prod with the spec value (#dc2626)", () => {
    expect(themes).toMatch(/--tv-env-prod:\s*#dc2626/);
  });

  it("defines --tv-env-prod-wash with the spec value (#fef2f2)", () => {
    expect(themes).toMatch(/--tv-env-prod-wash:\s*#fef2f2/);
  });

  it("defines --tv-env-prod-text with the spec value (#7f1d1d)", () => {
    expect(themes).toMatch(/--tv-env-prod-text:\s*#7f1d1d/);
  });

  it("defines --tv-env-staging with the spec value (#ea580c)", () => {
    expect(themes).toMatch(/--tv-env-staging:\s*#ea580c/);
  });

  it("defines --tv-env-staging-wash with the spec value (#fff7ed)", () => {
    expect(themes).toMatch(/--tv-env-staging-wash:\s*#fff7ed/);
  });

  it("defines --tv-env-staging-text with the spec value (#7c2d12)", () => {
    expect(themes).toMatch(/--tv-env-staging-text:\s*#7c2d12/);
  });

  // AC-253-02 — `--tv-warning` 의 값이 spec deep orange (#ea580c) 로
  // 정의된다. Pre-Sprint 253 에는 `--tv-warning` 자체가 정의돼 있지
  // 않아 (`--color-warning` 은 `--tv-status-connecting` 을 가리킴),
  // 본 sprint 가 universal :root 에 신규 정의로 도입한다.
  it("defines --tv-warning with the deepened spec value (#ea580c)", () => {
    expect(themes).toMatch(/--tv-warning:\s*#ea580c/);
  });

  // AC-253-02 — `--tv-status-connecting` 은 amber `#f59e0b` 그대로 보존.
  // "connecting" 의미와 "warning/staging" 의미를 시각적으로 분리한다.
  it("preserves --tv-status-connecting amber (#f59e0b) in every theme", () => {
    // 144 theme variants (72 themes × 2 modes) 모두에서 amber 유지.
    const matches = themes.match(/--tv-status-connecting:\s*#f59e0b/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(72);
  });

  // 회귀 가드 — `--tv-warning` 이 다시 amber 로 회귀하지 않도록.
  it("does not reintroduce amber #f59e0b for --tv-warning", () => {
    expect(themes).not.toMatch(/--tv-warning:\s*#f59e0b/);
  });
});
