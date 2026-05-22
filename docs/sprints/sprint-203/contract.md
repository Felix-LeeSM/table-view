# Sprint 203 — Contract

Sprint: `sprint-203` (refactor — `any` / `as unknown as` 정리).
Date: 2026-05-05.
Type: refactor (행동 변경 0; 타입 narrowing only).

`docs/PLAN.md` Sprint 203 row + `/CODE_SMELLS.md` §3.
짧은 sprint. `useSqlAutocomplete.ts` 7곳 + `mongoAutocomplete.ts` 2곳.

## Sprint 안에서 끝낼 단위

### `useSqlAutocomplete.ts` — `Record<string, any>` 7곳 → `SQLNamespace`

`SQLNamespace` (codemirror lang-sql 의 union type) 의 form 1 =
`Record<string, SQLNamespace>` 로 정확화. `Completion` (autocomplete) import
추가.

7개 use site 매핑:
- `const ns: Record<string, any>` → `Record<string, SQLNamespace>`
- `const reservedToken = (...): any =>` → `(...): { self: Completion; children: SQLNamespace }`
- `const cachedColumnsByName: Record<string, Record<string, any>>` →
  `Record<string, Record<string, SQLNamespace>>`
- `const colNs: Record<string, any>` (×3) → `Record<string, SQLNamespace>`
- `pickColumns return Record<string, any>` → `Record<string, SQLNamespace>`
- `addQuotedAlias colNs: Record<string, any>` → `Record<string, SQLNamespace>`

eslint-disable 주석 6 줄 모두 제거.

### `mongoAutocomplete.ts` — `as unknown as MinimalSyntaxNode` 2곳 → type annotation

`tree.resolveInner(pos, -1)` return type (`SyntaxNode`) 가 자체 정의
`MinimalSyntaxNode` interface 와 structurally compatible — 우회 cast
(`as unknown as`) 불필요. 단순 `const node: MinimalSyntaxNode = ...` 으로.

2개 use site:
- `classifyPosition` (line 246)
- `closestObjectIsInArray` (line 328)

`MinimalSyntaxNode` interface 정의 (line 17-26) 보존 — 의도적 abstraction
(lezer SyntaxNode 의 사용 surface 만 명시화). 다만 cast 우회 layer 만
정리.

## Acceptance Criteria

### AC-203-01 — `any` 0건

- `grep -nE "(:|=) *any\b|<any>" useSqlAutocomplete.ts mongoAutocomplete.ts`
  → 0 match.
- `eslint-disable.*no-explicit-any` 0건.

### AC-203-02 — `as unknown as` 0건

- `grep -n "as unknown as" useSqlAutocomplete.ts mongoAutocomplete.ts` → 0 match.

### AC-203-03 — 회귀 0

- `useSqlAutocomplete.test.ts` + `mongoAutocomplete.test.ts` baseline
  통과 — 36 tests pass.
- 전체 vitest baseline 동등 (188 files / 2725 tests).
- tsc + lint 0 error.

## Out of scope

- `MinimalSyntaxNode` interface 제거 / `@lezer/common` 직접 import — abstraction
  보존이라 본 sprint 미적용.
- 다른 파일의 `any` 정리 — CODE_SMELLS §3 의 본 두 파일만 enumerate.
- autocomplete 의 동작 변경 (행동 변경 0).

## 검증 명령

```sh
pnpm tsc --noEmit
pnpm lint
pnpm vitest run src/hooks/useSqlAutocomplete.test.ts src/lib/mongo/mongoAutocomplete.test.ts
pnpm vitest run
```

기대값: tsc 0 / lint 0 / autocomplete tests 36 pass / 전체 188 files
2725 tests pass.
