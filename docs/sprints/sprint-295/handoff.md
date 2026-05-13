# Sprint 295 — Handoff

## 상태: PASS

5 슬라이스 (A → B → C → D → E) 모두 완료. harness 워크플로 + tdd 스타일.
Generator 위임 3 회 (Slice A, B, D), 나머지 직접.

## 인도물

- `src/lib/sql/cteColumnCompletion.ts` — CTE / derived subquery virtual table
  source. paren-depth-aware mini-parser. SELECT * 폴백, CTE 체이닝 1 단계,
  schema-qualified inner table, WITH RECURSIVE explicit column list.
- `src/lib/sql/cteColumnCompletion.test.ts` — 16 it (4 happy + 5 guard + 7
  edge).
- `src/lib/sql/sqlCompletionLevel3.test.ts` — 8 baseline (Slice B 후
  GREEN) + 3 dedup.
- `src/components/query/SqlQueryEditor.tsx` — `buildSqlLang` 에 cte source
  등록.

## 회귀 가드 갱신

- sprint-292 / 294 / 295 의 모든 it GREEN.
- 전체 vitest 3349 passed | 10 skipped.

## 정책 결정

- CTE wins: 우리 source 내부 정책. lang-sql built-in 은 우리가 막을 수 없는
  영역이지만 CodeMirror autocompletion 의 dedup + Set dedup 이 사용자 popup
  중복 표시를 흡수.
- 1 단계 CTE 체이닝 (b 가 a 참조 시 a 의 컬럼 inherit) 만 지원. 더 깊은
  재귀는 안전한 null.
- alias-position reserved-word (outer, inner) 도 alias 로 인식.

## 다음

- sprint-296: lateral / window / set-op chain 등 희귀 변형 (필요 시).
- 외부 IDE parity 의 메인 deliverable (Level-1 / 2 / 3) 도달.
