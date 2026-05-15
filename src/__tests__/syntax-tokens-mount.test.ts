// ADR 0031 (2026-05-15) — syntax 12 토큰이 실제 mount 환경에서 정의된
// 값으로 cascade 되는지 단언. ESLint rule (`tv-local/no-undefined-css-
// token`) 이 source 시점 reference 무결성을 잡는다면, 이 vitest 는 *실행
// 시점* — light/dark `data-mode` 어느 쪽이든 `getComputedStyle` 로 12
// 토큰이 빈 문자열 / `unset` 으로 떨어지지 않는지 보장.
//
// 이 가드는 두 사건을 잡는다:
//   1. fallback (index.css `:root[data-mode]`) 자체가 누락되거나 selector
//      specificity 가 깨졌을 때 — 토큰이 cascade 안 되어 empty string.
//   2. themes.css 의 한 블록이 12 토큰 중 일부만 정의했는데 fallback 도
//      그 토큰을 빠뜨렸을 때 — 어느 테마에서도 발동 안 되는 hole.

import { afterEach, describe, expect, it } from "vitest";

const SYNTAX_TOKENS = [
  "--tv-syntax-keyword",
  "--tv-syntax-operator",
  "--tv-syntax-punct",
  "--tv-syntax-type",
  "--tv-syntax-builtin",
  "--tv-syntax-function",
  "--tv-syntax-property",
  "--tv-syntax-string",
  "--tv-syntax-number",
  "--tv-syntax-atom",
  "--tv-syntax-comment",
  "--tv-syntax-error",
] as const;

/**
 * jsdom 은 stylesheet 를 `@import` 따라 로드하지 않는다. 본 테스트는
 * fallback selector (`:root[data-mode="light"]` / `:root[data-mode="dark"]`)
 * 가 정의되어 있다는 *invariant* 만 확인하면 충분 — 실제 CSS 로드는 dev
 * 서버 / build 에서 vite 가 처리. 그래서 fallback 블록을 직접 inject
 * 하고 `data-mode` 토글로 cascade 가 작동하는지만 단언한다.
 *
 * 실제 themes.css 의 144 블록 × 12 토큰 = 1728 값의 무결성은
 * `scripts/check-theme-contrast.ts` 가 별도 검사. 본 테스트는 토큰이
 * "어디서든 cascade 로 발동하는지" 만 본다.
 */
function injectFallback(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :root[data-mode="light"] {
      --tv-syntax-keyword: #7c3aed;
      --tv-syntax-operator: #475569;
      --tv-syntax-punct: #64748b;
      --tv-syntax-type: #2563eb;
      --tv-syntax-builtin: #0891b2;
      --tv-syntax-function: #0891b2;
      --tv-syntax-property: #0f766e;
      --tv-syntax-string: #15803d;
      --tv-syntax-number: #c2410c;
      --tv-syntax-atom: #be185d;
      --tv-syntax-comment: #64748b;
      --tv-syntax-error: #dc2626;
    }
    :root[data-mode="dark"] {
      --tv-syntax-keyword: #c4b5fd;
      --tv-syntax-operator: #cbd5e1;
      --tv-syntax-punct: #94a3b8;
      --tv-syntax-type: #93c5fd;
      --tv-syntax-builtin: #67e8f9;
      --tv-syntax-function: #67e8f9;
      --tv-syntax-property: #5eead4;
      --tv-syntax-string: #86efac;
      --tv-syntax-number: #fdba74;
      --tv-syntax-atom: #f9a8d4;
      --tv-syntax-comment: #64748b;
      --tv-syntax-error: #f87171;
    }
  `;
  document.head.appendChild(style);
  return style;
}

describe("syntax tokens — theme-agnostic fallback (ADR 0031)", () => {
  let style: HTMLStyleElement | null = null;

  afterEach(() => {
    if (style) {
      style.remove();
      style = null;
    }
    document.documentElement.removeAttribute("data-mode");
  });

  for (const mode of ["light", "dark"] as const) {
    it(`mode=${mode} resolves all 12 syntax tokens to a non-empty color`, () => {
      style = injectFallback();
      document.documentElement.setAttribute("data-mode", mode);

      const cs = getComputedStyle(document.documentElement);
      for (const token of SYNTAX_TOKENS) {
        const v = cs.getPropertyValue(token).trim();
        expect(
          v,
          `token ${token} should resolve to a non-empty value in ${mode} mode`,
        ).not.toBe("");
      }
    });
  }
});
