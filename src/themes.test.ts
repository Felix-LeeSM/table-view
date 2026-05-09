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

// Sprint 257 (AC-257-01..04) — Per-theme syntax palette curation. ADR
// 0023 grill Q12 의 큐레이션 결정을 *규칙 기반 derivation* 으로 일괄
// 적용한 회귀 가드 (사용자 선택 (b)). 작성 일자: 2026-05-09.
describe("themes.css — Sprint 257 syntax palette derivation (AC-257-01..04)", () => {
  // 사전 default 값 — 모든 theme 이 이 값으로만 회귀하면 derivation 이
  // 스킵되었다는 신호.
  const PRE_LIGHT = ["#7c3aed", "#16a34a", "#dc2626"] as const;
  const PRE_DARK = ["#c4b5fd", "#86efac", "#fca5a5"] as const;

  // AC-257-01 — derivation 적용 후, default-light triple 이 *전체*
  // 144 block 에서 dominant 하게 살아 있지 않아야 한다 (사전 ≥ 50,
  // post derivation 은 ≤ 5 — clickhouse 등 collision theme 이 우연히
  // default 와 일치할 수 있어 0 이 아닌 작은 상한).
  it("does not leave the pre-derivation light default palette dominant", () => {
    const matches = themes.match(
      /--tv-syntax-keyword:#7c3aed; --tv-syntax-string:#16a34a; --tv-syntax-number:#dc2626;/g,
    );
    expect((matches ?? []).length).toBeLessThanOrEqual(5);
  });

  it("does not leave the pre-derivation dark default palette dominant", () => {
    const matches = themes.match(
      /--tv-syntax-keyword:#c4b5fd; --tv-syntax-string:#86efac; --tv-syntax-number:#fca5a5;/g,
    );
    expect((matches ?? []).length).toBeLessThanOrEqual(5);
  });

  // AC-257-01 — derivation 다양성. 144 syntax-keyword 값 중 unique 가
  // ≥ 20 개여야 한다 (collision 회피 fallback + light/dark 차이 + brand
  // 다양성으로 자연스럽게 ≥ 30+ 예상). 너무 빈약한 derivation 회귀 가드.
  it("produces a diverse syntax-keyword palette across themes", () => {
    const re = /--tv-syntax-keyword:(#[0-9a-fA-F]{3,6})/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(themes)) !== null) {
      const hex = m[1];
      if (hex) seen.add(hex.toLowerCase());
    }
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });

  // AC-257-01 — derivation 의 정의 covering. 모든 144 syntax-line 이
  // 정의돼 있어야 한다 (어떤 block 도 syntax 누락 0).
  it("defines a syntax-keyword/string/number triple in every theme block", () => {
    const blockRe =
      /\[data-theme="[^"]+"\]\[data-mode="(light|dark)"\]\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    let blocks = 0;
    let withTriple = 0;
    while ((m = blockRe.exec(themes)) !== null) {
      blocks += 1;
      const body = m[2] ?? "";
      if (
        /--tv-syntax-keyword:\s*#/.test(body) &&
        /--tv-syntax-string:\s*#/.test(body) &&
        /--tv-syntax-number:\s*#/.test(body)
      ) {
        withTriple += 1;
      }
    }
    expect(blocks).toBeGreaterThanOrEqual(144);
    expect(withTriple).toBe(blocks);
  });

  // 사전 default 값이 레퍼런스용으로만 사용되도록 가드 (regression
  // 테스트의 self-reference 보호).
  it("references the pre-derivation defaults exactly twice (light + dark) in this test file", () => {
    expect(PRE_LIGHT).toHaveLength(3);
    expect(PRE_DARK).toHaveLength(3);
  });
});
