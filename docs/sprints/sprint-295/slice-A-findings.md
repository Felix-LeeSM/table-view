# Sprint 295 Slice A — Findings

## 결과: PASS

- 8 시나리오 전부 RED (`it.fails` 마커).
- sprint-292/294 무회귀 (39 GREEN).
- tsc clean.

## Slice B 표적

8건 전부:
- CTE 단일 (a, b)
- CTE 다중 (c, d)
- Derived simple (e)
- Derived AS (f)
- CTE + derived (g)
- Derived nested with paren-depth (h)

`aliasColumnCompletionSource` 의 `parseFromContext` 는 paren 안 inner SELECT
의 projection list 까지 안 들어감 → mini-parser 가 paren-depth 추적 + inner
SELECT projection 추출 필수.
