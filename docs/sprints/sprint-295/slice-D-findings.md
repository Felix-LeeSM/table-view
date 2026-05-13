# Sprint 295 Slice D — Findings

## 결과: PASS

- 7 edge it 모두 GREEN.
- 전체 vitest 3346 passed | 10 skipped.
- tsc clean.

## 보강 내역

`cteColumnCompletion.ts` 의 mini-parser:
- D1 SELECT * 폴백 — inner FROM base table 을 namespace lookup. plain /
  verbose / flat-list 3 표현 모두 흡수.
- D4 schema-qualified — sprint-294 의 dotted-identifier coalescing 재사용.
- D7 1단계 체이닝 — `extractCtes` 가 `knownVirtual` map 을 `extractProjection
  Columns` 에 전달, inner SELECT * 의 fallback 이 namespace 전에 그 map 먼저
  조회.

D2 (JOIN inner), D3 (explicit AS), D5 (WITH RECURSIVE explicit list), D6
(alias 충돌 CTE wins) 는 Slice B 가 이미 처리 — 단언만 추가.

## 잔여 위험

- 더 깊은 CTE chaining (2+ 단계) — 안전한 null.
- lateral / window / set-op 등 — sprint-296 후보.

## 다음

Slice E — cross-source dedup 단언.
