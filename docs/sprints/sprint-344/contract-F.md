# Sprint Contract: sprint-344 / Slice F — Integration + handoff

## Summary

- Goal: Slice A~E 가 disk 에 있는 상태에서 grid 통합 end-to-end 단언. Mongo
  `DocumentDataGrid` 와 RDB `DataGridTable` 모두 `+ key` / `+ item` 동작
  검증. 사용자 트레이스: 새 key/item 클릭 → input → Enter → ghost row 보임
  → Commit preview SQL/MQL 의 정확성. handoff.md 작성.
- Owner: Generator agent
- Verification Profile: `mixed` (command + static doc)

## In Scope

- **Mongo end-to-end**: `DocumentDataGrid` 통합 테스트 — 객체 cell 의 inline
  tree 에서 `+ key` 클릭 → key/value 입력 → Enter → ghost row 표시 →
  Commit preview 가 `$set: { "<col>.<newkey>": <value> }` 포함.
- **RDB jsonb end-to-end**: `DataGridTable` (또는 `DataGrid.lifecycle.test.tsx`)
  — jsonb cell `+ key` 흐름 → Commit preview SQL 이 `jsonb_set(<col>, '{<segments>}', '<json>'::jsonb, true)` 포함.
- **RDB ARRAY end-to-end**: ARRAY cell `+ item` → preview SQL 이 `ARRAY[..., <new>]::etype[]` 포함.
- **`_id` 가드** (Mongo only): `DocumentDataGrid` 의 root tree 에서 `_id`
  key add 가 reject 되는지 검증. 또는 `DocumentTreePanel` 에서 `+ key`
  validation 에 `_id` 추가 reject — 위치는 generator 가 결정. 단, Mongo
  cell 의 root level 에서만 발동 (nested 객체 안의 `_id` 는 OK).
- **handoff.md 작성** — Slice A~F 누적 변경, 결정, deferred 항목 기록.

## Out of Scope

- Slice A~E 의 internal 변경 (이미 완료).
- MySQL JSON / SQLite JSON dispatch — Sprint 343 deferred 유지.
- jsonb[]/composite — Sprint 343 deferred 유지.
- Virtualized RDB grid (>200 rows) — Sprint 343 deferred 유지.
- 사용자 parallel 작업 (autocompleteTheme, mongoAutocomplete) 검증/수정 —
  무관.

## Invariants

- 기존 Mongo lifecycle / editing / nested test suite 회귀 0.
- 기존 RDB lifecycle / editing test suite 회귀 0.
- 신규 통합 테스트 `2026-05-15` 코멘트.
- `safeStringifyCell` rule.
- DocumentTreePanel paradigm-agnostic 유지.

## Acceptance Criteria

- `AC-344-F-01` (Mongo `+ key` E2E) — `DocumentDataGrid` 통합 테스트:
  특정 row 의 `meta` (객체 cell) inline tree 열림 → `+ key` 클릭 → key
  input 에 "role", value input 에 "owner" → Enter → ghost row 보임 (NEW
  badge). preview / MQL 가 `$set: { "meta.role": "owner" }` 포함하는
  updateOne 1회. 라인 별 SQL/MQL 단언.
- `AC-344-F-02` (RDB jsonb `+ key` E2E) — `DataGridTable` 또는
  `DataGrid.lifecycle.test.tsx` 통합 테스트: jsonb cell inline tree 에서
  `+ key` → "newKey"/"42" 입력 → Enter → preview SQL 이
  `jsonb_set(<col>, '{"newKey"}', '42'::jsonb, true)` 포함.
- `AC-344-F-03` (RDB ARRAY `+ item` E2E) — text[] cell `+ item` →
  "c" 입력 → Enter → preview SQL `... = ARRAY[<orig...>, 'c']::text[]`.
- `AC-344-F-04` (`_id` add reject — Mongo) — Mongo root tree 에서 `+ key`
  에 `_id` 입력 → Enter → reject (aria-invalid + 메시지). `onCommitEdit`
  호출 안 됨. 단, `meta` 같은 nested 객체 안에 `_id` 는 OK (paradigm
  guard 는 root level 만).
- `AC-344-F-05` (회귀 0) — Mongo + RDB 의 기존 leaf edit, leaf delete, BSON,
  inline cell edit 모두 동작.
- `AC-344-F-06` (handoff.md) — `docs/sprints/sprint-344/handoff.md` 작성.
  Slice A~F 누적 변경, 핵심 결정, deferred 항목 기록.

## Design Bar / Quality Bar

- `_id` reject 위치: `DocumentTreePanel` 의 `+ key` validation 에 root
  level + `_id` 분기 추가. Mongo / RDB 양쪽 모두 적용 (RDB 도 `_id` 같은
  reserved 이름 가능 — 다만 RDB 는 컬럼 이름 충돌 시 jsonb_set 가 자체
  처리하므로 sprint 의 범위는 Mongo root level 만 명시).
- 또는 grid 측에서 paradigm-specific guard — 단 `DocumentTreePanel` 의
  paradigm-agnostic invariant 와 충돌하므로 panel 측 처리 시 prop 으로
  `forbiddenRootKeys: Set<string>` 같은 prop 받아 generic 하게 구현 (또는
  단순히 `parentPath === ""` 일 때 `_id` 만 reject — Mongo grid 에서만
  panel 마운트되므로 우회적으로 generic).
- 결정: Generator 가 `forbiddenRootKeys` prop 또는 `parentPath === ""` +
  `_id` 둘 중 더 자연스러운 쪽 결정.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.nested.test.tsx` (해당 파일 존재 여부 확인).
2. `pnpm vitest run src/components/rdb/DataGrid.lifecycle.test.tsx`.
3. `pnpm vitest run` 전체 — autocompleteTheme 2 fail 제외 회귀 0.
4. `pnpm tsc --noEmit` — clean.
5. `pnpm lint` — clean.
6. `handoff.md` 작성 + 검토.

### Required Evidence

- Generator must provide:
  - 변경 파일 + 목적
  - 각 AC 매핑
  - 명령 결과
- handoff.md 의 internal links 가 유효한지 확인.

## Test Requirements

### Integration Tests (필수)
- AC-344-F-01 ~ 05 각각 ≥ 1 case
- 모든 신규 case 에 `2026-05-15` 코멘트

### Scenario Tests (필수)
- [ ] Happy path: 각 paradigm 의 add → commit preview 단언
- [ ] 경계: `_id` reject, root-level vs nested
- [ ] 회귀: 기존 edit/delete/BSON 전부

## Test Script

1. `pnpm vitest run`
2. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose agent
- Write scope (예상 5-7 파일):
  - `src/components/document/DocumentTreePanel.tsx` — `_id` guard 추가
    (선택: prop 으로 generic, 또는 `parentPath === ""` 분기)
  - `src/components/document/DocumentTreePanel.test.tsx` — `_id` reject
    테스트
  - `src/components/document/DocumentDataGrid.nested.test.tsx` 또는
    `.test.tsx` — Mongo E2E
  - `src/components/rdb/DataGrid.lifecycle.test.tsx` — RDB E2E
  - `docs/sprints/sprint-344/handoff.md`

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- handoff.md 작성 완료
