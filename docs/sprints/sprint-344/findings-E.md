# Sprint 344 / Slice E Evaluation Scorecard

평가자: orchestrator (코드 inspection + 명령 재실행).

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | `emitJsonbUpdate` 의 모든 `jsonb_set(...)` template 에 `, true)` 추가 — 의미 동일 + create_missing 확장. Cell null 시 base 가 `COALESCE(<col>, '{}'::jsonb)` 로 1회 wrap, chained 후속 jsonb_set 가 accumulator 로 받음. ARRAY push past end 는 기존 `extraIndexes` 분기 — regression lock 추가. mqlGenerator.ts 미터치 (sentinel guard 이미 `!nested` 만 발동). |
| Completeness | 9/10 | AC-344-E-01~07 모두 cover (11 신규 + 6 갱신). Edge cases (add+edit+unset mixed jsonb, empty array first push, top-level sentinel contrast) 포함. 모든 신규 case 에 `2026-05-15` 코멘트. |
| Reliability | 9/10 | sqlGenerator 의 `emitJsonbUpdate` 시그니처에 `cellValue` 추가 — private 함수, 외부 영향 없음. Public API (`generateSql`, `generateSqlWithKeys`) 변경 없음. |
| Verification Quality | 9/10 | 108/108 (sqlGenerator + mqlGenerator targeted). 3919 full suite (autocompleteTheme 2 fail 은 user parallel — 무관, sprint 시작부터 존재). tsc/lint clean. |
| **Overall** | **9/10** | |

## Verdict: PASS

## Sprint Contract Status

- [x] AC-344-E-01 — `AC-344-E-01: jsonb create-missing key — existing key 옆에 새 key add` (sqlGenerator.test.ts)
- [x] AC-344-E-02 — `AC-344-E-02: jsonb null base` + chained-COALESCE follow-up
- [x] AC-344-E-03 — `AC-344-E-03: ARRAY push past end` + sequential + empty-first
- [x] AC-344-E-04 — `AC-344-E-04: 비-structural (text) 컬럼 nested-add` reject
- [x] AC-344-E-05 — `AC-344-E-05: nested $set 가 missing path 를 native 로 생성` (mqlGenerator.test.ts)
- [x] AC-344-E-06 — `AC-344-E-06: sentinel cell {} + nested-only newKey — guard 미발동` + contrast
- [x] AC-344-E-07 — 4-arg form universal (기존 6개 jsonb_set assertion 갱신)

## 중요 Assumption (Slice F 가 검증할 것)

- **PendingEdit key shape**: commit("role", v) on `meta` column (col idx 1) → key `"0-1:role"` (NOT `"0-1:meta.role"`). col.name 이 column 이름, `:` 뒤가 column 내부 path. mqlGenerator 가 col.name + nested.path 를 joining. Slice F 의 grid 통합이 이 shape 을 정확히 emit 하는지 end-to-end 단언 필요.
- **COALESCE wrap** 은 cell `null`/`undefined` 일 때만. `{}` 객체엔 적용 안 함.

## Verification

- `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts src/lib/mongo/mqlGenerator.test.ts` — 108/108 pass
- `pnpm tsc --noEmit` — clean
- `pnpm lint` — clean
- `pnpm vitest run` 전체 — 3919 pass, 10 skipped, 2 fail (autocompleteTheme user parallel)

## Scope Discipline

✓ 3 파일 수정 (sqlGenerator.ts/test.ts, mqlGenerator.test.ts). mqlGenerator.ts 미터치 (inspection 으로 확인). 다른 영역 (UI, jsonTree, autocomplete, mongo grid wiring) 미터치.

## Findings

없음 (PASS). Slice F 의 입력 조건은 위 "중요 Assumption" 두 항목을 그대로 사용.
