# Sprint 295 Slice E — Findings

## 결과: PASS

- 3 dedup it GREEN (CTE / derived / 이름 충돌).
- 전체 vitest 3349 passed | 10 skipped.
- tsc clean.

## 정책 확정

- 한 호출의 후보 라벨 셋은 `callAll` 의 Set dedup 으로 unique.
- "CTE wins" 는 우리 source 내부 정책 — `cteColumnCompletion` 은 가상 컬럼만
  emit. lang-sql 의 built-in `schemaCompletionSource` 가 같은 prefix 에서
  base table 컬럼도 emit 하는 것은 우리 source 가 막을 수 없는 영역 (lang-
  sql 의 의도된 동작). 사용자 popup 에서는 CodeMirror autocompletion 의
  built-in dedup 이 같은 라벨을 한 번만 표시 — 가상 + base 의 다른 컬럼이
  같은 popup 에 합쳐서 노출되는 것은 IDE parity 측면에서도 수용 가능.
- 우리 deliverable: (1) 가상 컬럼이 popup 에 빠지지 않음, (2) 라벨 unique.

## Sprint 295 마감

5 slice 모두 PASS:
- Slice A: 8 RED baseline (it.fails 마커).
- Slice B: cteColumnCompletionSource — paren-depth mini-parser + 8 RED→GREEN.
- Slice C: SqlQueryEditor wire.
- Slice D: 7 edge (SELECT *, JOIN inner, AS, schema-qualified, RECURSIVE,
  CTE 충돌, 체이닝).
- Slice E: 3 dedup 회귀 가드.

User 의 "외부 IDE 수준" 자동완성 요구의 마지막 레이어 (Level-3) 도달. 다음
sprint 후보 (sprint-296): lateral / window / set-op chain 등 더 희귀한 변형.
