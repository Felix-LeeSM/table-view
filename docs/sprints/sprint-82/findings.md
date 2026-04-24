# Sprint 82 Findings

## Scorecard (System rubric)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | `databaseTypeToSqlDialect` 매핑 정확, Compartment reconfigure 경로 (QueryEditor.tsx:244-252) 가 `viewRef.current` 재사용. paradigm==="document" 시 dialect 무시 (L76-80) — JSON 경로 byte unchanged. 파서 레벨 `ensureSyntaxTree` + `Keyword` 노드 워크로 증거 확보. |
| Completeness (25%) | 9/10 | 10 개 AC 전부 테스트 매핑. 30 개 신규 테스트. `normalizeOptions` 가 legacy `Record<string, string[]>` 시그니처 후방호환. 병렬 경로 diff 0. |
| Reliability (20%) | 8/10 | Silent StandardSQL fallback 의도대로 동작. `useMemo` 로 dialect stable. `dialectRef` 로 mount effect stale closure 회피. `normalizeOptions` 휴리스틱 (모든 value 가 array) 은 이론상 brittle 이지만 현재 호출자는 문제 없음. |
| Verification Quality (20%) | 9/10 | 6 개 required check 전부 실행 (tsc/lint 0, 전체 vitest 1444/1444, target 107/107, diff 검증). 증거가 parser output 기반이라 견고. 유일한 minor gap: AC-04 Postgres lowercase 선호 해석을 generator 가 "원본 + quoted alias" 로 택함 — contract 가 두 해석 모두 허용. |
| **Overall** | **8.75/10** | 4/4 dimension ≥ 7 |

## Verdict: PASS

## AC Coverage

- AC-01 Postgres keywords — QueryEditor.test.tsx:467-479 (`RETURNING`, `ILIKE` Keyword 노드).
- AC-02 MySQL keywords — QueryEditor.test.tsx:482-494 (`REPLACE`, `DUAL`).
- AC-03 SQLite keywords — QueryEditor.test.tsx:497-509 (`AUTOINCREMENT`, `PRAGMA`).
- AC-04 Dialect-aware quoting — useSqlAutocomplete.test.ts:280-394.
- AC-05 QueryTab dialect prop — QueryTab.test.tsx:1175-1220.
- AC-06 EditorView identity preserved — QueryEditor.test.tsx:535-565.
- AC-07 document paradigm unaffected — QueryEditor.test.tsx:595-611.
- AC-08 Fallback StandardSQL — QueryEditor.test.tsx:515-529, QueryTab.test.tsx:1181-1200.
- AC-09 `src-tauri/` + 병렬 경로 diff empty (검증 실행 완료).
- AC-10 30 개 신규 테스트 pass.

## Minor Findings (P3/P4)

1. **P3** `normalizeOptions` 휴리스틱 brittle.
   - Current: `values.every(Array.isArray)` 로 legacy 감지.
   - Suggestion: `"dialect" in arg || "tableColumns" in arg ? options : legacy` 로 key-based 판별.
2. **P4** `sqlDialect.test.ts:53-55` 에 중복 단언 (`expect(databaseTypeToSqlDialect("postgresql")).toBe(PostgreSQL)` 가 앞선 테스트와 동일).
   - Suggestion: 중복 삭제 또는 comment 로 흡수.
3. **P4** Postgres lowercase 선호 결정 comment 가 `useSqlAutocomplete.ts` 에 없음.
   - Suggestion: 한 줄 주석으로 "preserve casing + quoted alias" 선택 이유 기록.
4. **P4** Silent fallback UI 힌트 없음 — 의도된 choice, Phase 7+ 에서 재검토.

P1/P2: 0 건.
