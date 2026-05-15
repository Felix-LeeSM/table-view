# Sprint Contract: sprint-344 / Slice D — JSON coercion helper

## Summary

- Goal: 사용자가 `+ key` / `+ item` 에서 친 raw string 값을 JSON 타입으로 변환
  하는 pure helper `coerceTreeAddValue` 추가. "outer-quotes rule" — 따옴표
  없으면 JSON.parse 시도, 따옴표 있으면 string, parse 실패 시 raw string.
  Slice B/C 가 commit 전에 호출.
- Audience: DocumentTreePanel 의 `+ key` / `+ item` 입력 commit 경로.
- Owner: Generator agent
- Verification Profile: `command`

## In Scope

- 새 함수 `coerceTreeAddValue(input: string): unknown` 또는 그에 상응하는
  반환 타입. 위치는 `src/lib/jsonTree.ts` 또는 인근 새 모듈 (Generator
  결정).
- Unit test 파일에 모든 케이스 cover.

## Out of Scope

- DocumentTreePanel UI 변경 (Slice B/C 가 호출).
- Generator dispatch — Slice E.
- Grid 통합 — Slice F.
- Bson wrapper (`__bson__:` prefix) 처리 — 기존 BSON inline editor 가
  담당.

## Invariants

- pure 함수, 부수 효과 0.
- 같은 input → 같은 output (determinism).
- 절대 throw 안 함 — parse 실패 시 fallback 으로 string 반환.
- `safeStringifyCell` 또는 `JSON.parse` 한쪽만 사용. `JSON.stringify` 의
  cell-domain 직접 호출 금지 — 단, **이 helper 는 parsing 만** 하므로
  `JSON.parse` 는 허용 (`no-restricted-syntax` rule 은 stringify 만 cover).

## Acceptance Criteria

- `AC-344-D-01` — `"42"` (따옴표 포함 string literal 의 string repr — 즉
  사용자가 `\"42\"` 또는 `"42"` 라고 친 그대로) → JSON.parse 성공해
  string `"42"` 반환.
- `AC-344-D-02` — `42` (따옴표 없음) → JSON.parse 성공해 number `42`.
- `AC-344-D-03` — `null` (따옴표 없음, 소문자) → JSON.parse 성공해 `null`.
- `AC-344-D-04` — `true`, `false` (따옴표 없음, 소문자) → boolean.
- `AC-344-D-05` — `{"a":1}` → object `{ a: 1 }`.
- `AC-344-D-06` — `[1, "x"]` → array `[1, "x"]`.
- `AC-344-D-07` — `hello world` (parse 실패) → raw string `"hello world"`.
- `AC-344-D-08` — `{broken` (parse 실패, malformed JSON) → raw string
  `"{broken"`.
- `AC-344-D-09` — 빈 문자열 `""` → JSON.parse 실패하므로 raw string
  `""` 반환. (또는 `null`? — 결정 명시 필요: 빈 문자열 commit 은 raw `""`)
- `AC-344-D-10` — 앞뒤 공백 (`  42  `) → trim 후 JSON.parse 시도. number
  `42` 반환. (Decision: trim 적용.)
- `AC-344-D-11` — pure 함수 검증: 같은 input 100회 호출 시 같은 output.

## Design Bar / Quality Bar

- 함수 signature 명확: `function coerceTreeAddValue(input: string): unknown`
  (또는 `string | number | boolean | null | unknown[] | Record<string, unknown>` 의 union).
- 내부에 try/catch 1개. 외부에 throw 0.
- 코멘트는 outer-quotes rule 한 줄, parse fallback 사유 한 줄.

## Verification Plan

### Required Checks

1. `pnpm vitest run <test file path>` — AC-344-D-01 ~ 11 모두 pass.
2. `pnpm vitest run` 전체 — 회귀 0.
3. `pnpm tsc --noEmit` — clean.
4. `pnpm lint` — clean.

### Required Evidence

- Generator must provide:
  - 변경 파일 + 목적
  - 각 AC 매핑 (test name)
  - 명령 출력 요약
- Evaluator must cite:
  - 각 AC pass evidence (test 위치 + 단언 라인)

## Test Requirements

### Unit Tests (필수)
- AC-344-D-01 ~ 11 각각 ≥ 1 case
- 추가 edge: 음수 (`-5`), 큰 수 (`1e308`), 0, 부동 (`3.14`)
- 모든 case 에 작성 이유 + `2026-05-15` 코멘트

### Coverage Target
- 신규 helper: 라인 100% (작은 함수)

### Scenario Tests (필수)
- [ ] Happy path: primitive types
- [ ] 경계: 빈 string, 공백만, malformed JSON
- [ ] Edge: nested object/array
- [ ] 회귀: 기존 `buildTreeNodes` / `filterTreeNodes` 미터치

## Test Script

1. `pnpm vitest run src/lib/jsonTree.test.ts`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose agent
- Write scope:
  - `src/lib/jsonTree.ts` (또는 새 작은 모듈)
  - `src/lib/jsonTree.test.ts` (또는 새 테스트)
- Merge order: Slice D 단독 또는 sprint-344 전체 commit 일부

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
