# Sprint 295 Slice B — Findings

## 결과: PASS

- 56 tests pass (Level-1 6 + Level-2 13 + Level-3 8 + updateColumnCompletion
  11 + alias 9 + cte 9).
- tsc clean.

## 산출

- `src/lib/sql/cteColumnCompletion.ts` — mini-parser + source. paren-depth
  단일 카운터, 멀티 CTE + derived (FROM/JOIN) 둘 다 추출, projection list
  에서 `col`, `tbl.col`, `col AS alias` 처리.
- `src/lib/sql/cteColumnCompletion.test.ts` — 9 it (4 happy + 5 guard).
- `src/lib/sql/sqlCompletionLevel3.test.ts` — `callAll` 에 cteSource 합산,
  8 `it.fails` → `it` 전이.

## 정책

- 알 수 없는 가상 alias / projection 추출 0 → null (alias source 가 base
  table 처리 그대로). false-positive shadow 없음.
- case-insensitive 매핑 (sprint-294 일관).
- alias-position 의 reserved-word (예: `outer`, `inner`) 도 alias 로 인식 —
  case (h) deliverable.

## 잔여 위험

- `SELECT *` 내부 CTE/derived → 가상 컬럼 0 (Slice D).
- 1단계 이상 CTE 체이닝 (Slice D).
- Wire 미적용 — `SqlQueryEditor` 는 Slice C.
