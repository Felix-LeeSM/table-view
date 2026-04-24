# Sprint 85 Handoff

## Status

- **Result**: PASS (Overall 9.0/10, all dimensions ≥ 7)
- **Attempts**: 1

## Changed Files

- `src/lib/mongoTokenize.ts` (신규) — pure JSON-ish tokenizer. `tokenizeMongo(src): MongoToken[]` with 8 kinds. `MONGO_ALL_OPERATORS` 를 read-only import 로 소비해 `$`-접두 + 등록된 operator 문자열을 `"operator"` kind 로 태깅 (L82-87). Invalid JSON / truncated / non-JSON 입력 모두 throw 없이 best-effort tokenize.
- `src/lib/mongoTokenize.test.ts` (신규, +10 tests) — happy path find filter, aggregate pipeline, full MQL vocabulary sweep, unknown `$` names, truncated JSON, arbitrary non-JSON, unterminated strings, booleans/null/numbers, whitespace.
- `src/components/shared/MongoSyntax.tsx` (신규) — `{sql, className?}` props (SqlSyntax 시그니처 mirror). 내부에서 `tokenizeMongo` 호출, operator token 에 `cm-mql-operator` class 부여 (L23). Sprint 83 editor decoration 과 동일 class 로 통일.
- `src/components/shared/MongoSyntax.test.tsx` (신규, +5 tests).
- `src/components/shared/QuerySyntax.tsx` (신규) — paradigm dispatcher. `{sql, paradigm?, queryMode?, className?}` props. L39-42 에서 `paradigm === "document"` 는 MongoSyntax, 그 외 (legacy/undefined 포함) 는 SqlSyntax.
- `src/components/shared/QuerySyntax.test.tsx` (신규, +7 tests) — rdb/document/legacy 분기, queryMode 전달, className forwarding, store identity 불변.
- `src/components/query/QueryTab.tsx` — L25 import swap, L829-834 history row JSX 교체. Sprint 84 의 execute/restore 로직은 byte-for-byte 불변.
- `src/components/query/QueryTab.test.tsx` (+2 tests) — AC-01 (rdb SQL class), AC-02 (document `cm-mql-operator`).
- `src/components/query/GlobalQueryLogPanel.tsx` — L8 import, L188-197 collapsed wrapper, L223-229 expanded wrapper 교체. Filter / search / dropdown / clear / close 로직 diff 0. `truncateSql(entry.sql, 80)` 은 caller 가 유지.
- `src/components/query/GlobalQueryLogPanel.test.tsx` (5 existing adjusted + 5 new) — AC-03 rdb/document/legacy collapsed, AC-04 expanded document, AC-05 truncate preservation.

총 30 개 신규 테스트 (AC-12 의 10 개 floor 대비 3 배).

## Checks Run

| Command | Result |
|---|---|
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm vitest run` (target 5 files) | all pass |
| `pnpm vitest run` (전체) | 1555 / 1555 pass (Sprint 84 baseline 1525 대비 +30) |
| `git diff --stat HEAD -- src-tauri/` | empty |
| `git diff --stat HEAD -- SqlSyntax.tsx sqlTokenize.ts mongoAutocomplete.ts queryHistoryStore.ts tabStore.ts QueryEditor.tsx QueryEditor.test.tsx useSqlAutocomplete.ts useMongoAutocomplete.ts sqlDialect.ts datagrid/ DataGrid.tsx DocumentDataGrid.tsx BsonTreeViewer.tsx QuickLookPanel.tsx QueryLog.tsx` | empty |

## Done Criteria Coverage

- Done Criteria 11 항목 + AC 12 항목 전부 충족. 상세 매핑은 `findings.md` 참조.

## Assumptions

- **Operator 판정은 정규화된 JSON 문자열 literal 에 한정** — `"$match"` 처럼 앞뒤 double-quote 가 모두 닫힌 토큰만 `operator` kind. Truncated mid-operator (예: `"$ma`) 은 `string` kind 로 fallback 되며 `cm-mql-operator` class 를 받지 않음 — collapsed 80-char slice 에서 발생 가능. Execution brief residual risk 로 기록된 허용 degradation.
- **`queryMode` prop 은 forward-compat 도입** — 현재 QuerySyntax 는 paradigm 만으로 분기하지만, 향후 aggregate 와 find 를 다른 color scheme 으로 구분할 여지를 프롭에 남김. 현재 렌더 로직에는 영향 없음.
- **`cm-mql-operator` class 명 통일** — Sprint 83 editor decoration 이 같은 class 를 CSS 에서 color 지정. History 에 동일 class 를 부여함으로써 CSS 단일 entry 로 editor + history 양쪽이 동시 반영.
- **Truncate 는 caller 가 유지** — `truncateSql(entry.sql, 80)` 은 GlobalQueryLogPanel 에 그대로. QuerySyntax 는 받은 sql 문자열을 그대로 tokenize. Truncate 후 JSON mid-cut 이 발생해도 tokenizer 가 throw 하지 않음을 AC-06 테스트가 보증.

## Residual Risk

- **Mid-operator truncation 에서 class 소실** — collapsed row 의 sql 이 정확히 `$match` 중간을 자를 경우 operator class 누락. 사용자 인지 손실은 미미 (`...` ellipsis 로 이미 절단 표시). 다음 sprint 의 UX 개선 후보.
- **Nested 가 큰 JSON (>10k char) 의 tokenize 비용** — 현 history panel 에서 truncate 가 이미 일어나므로 실 영향 없음. 그러나 raw `<pre>` expanded view 는 full sql 을 tokenize. 큰 document pipeline 이 있을 경우 첫 렌더 비용 증가 가능 — 현재 테스트 셋 범위 (수백 char) 에서는 측정 불필요.
- **Sprint 86+ Color 개선** — 현재 `MongoSyntax` 는 `text-syntax-keyword` 와 같은 semantic class 를 재사용 (SQL 과 동일 팔레트). document-specific palette (예: BSON type 별 색상) 는 후속 sprint UX 작업.

## Follow-up

- Master spec 의 Sprint 81 범위 (Sprints 82-85) 완료 — provider-aware autocomplete + history 하이라이팅 feature 전 체인 완성.
- 남은 task #5 (Sprint 80 — Inline edit + MQL Preview + Add/Delete, Phase 6 plan F) 는 별도 Phase. 본 sprint 범위 밖.
- Document-specific color palette / BSON type 별 tokenize (`$oid`, `$date`, `$numberLong`) 는 후속 UX sprint 후보.
