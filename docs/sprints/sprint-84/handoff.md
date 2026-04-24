# Sprint 84 Handoff

## Status

- **Result**: PASS (Overall 9.35/10, all dimensions ≥ 7)
- **Attempts**: 1

## Changed Files

- `src/stores/queryHistoryStore.ts` — `QueryHistoryEntry` 필드 확장 (`paradigm`/`queryMode` required, `database`/`collection` optional), `addHistoryEntry` payload 에서 paradigm/queryMode optional 허용 + 내부 default (`"rdb"`/`"sql"`). `filteredGlobalLog` 가 legacy entry 를 read path 에서 normalize.
- `src/stores/queryHistoryStore.test.ts` (+5 tests) — rdb/sql / document/find / document/aggregate shape 단언, legacy read normalize, paradigm 생략 defaulting.
- `src/stores/tabStore.ts` — `loadQueryIntoTab(payload)` helper 추가. `canInPlace` predicate 로 5 case 를 "spawn vs in-place" 2 outcome 으로 수렴.
- `src/stores/tabStore.test.ts` (+7 tests) — no active / non-query active / same paradigm + same conn / different paradigm / different conn / document find→aggregate in-place / db/coll propagate to spawned tab.
- `src/components/query/QueryTab.tsx` — 5 개 `addHistoryEntry` 호출부 전부 `paradigm/queryMode/database/collection` 전달. History row double-click + "Load into editor" 버튼이 공통 `handleLoad` closure 를 통해 `loadQueryIntoTab` 경로로 교체. `entry.paradigm ?? "rdb"` / `entry.queryMode ?? "sql"` defensive default 2 layer.
- `src/components/query/QueryTab.test.tsx` (+7 tests) — rdb / document-find / document-aggregate 실행 → entry shape, double-click in-place, button in-place, cross-paradigm spawn + 원본 tab 무오염.
- `src/components/query/QueryLog.test.tsx` — TS compile fix only (14 entry 리터럴에 `paradigm: "rdb"` / `queryMode: "sql"` 주입). Source `QueryLog.tsx` 는 diff 0.
- `src/components/query/GlobalQueryLogPanel.test.tsx` — TS compile fix only (17 entry 리터럴). Source `GlobalQueryLogPanel.tsx` 는 diff 0.

총 19 개 신규 테스트.

## Checks Run

| Command | Result |
|---|---|
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm vitest run` (target 3 files) | 150 / 150 pass |
| `pnpm vitest run` (전체) | 1525 / 1525 pass (Sprint 83 baseline 1506 대비 +19) |
| `git diff --stat HEAD -- src-tauri/` | empty |
| `git diff --stat HEAD -- datagrid/ DataGrid.tsx DocumentDataGrid.tsx BsonTreeViewer.tsx QuickLookPanel.tsx useSqlAutocomplete.ts useMongoAutocomplete.ts sqlDialect.ts mongoAutocomplete.ts QueryEditor.tsx QueryEditor.test.tsx GlobalQueryLogPanel.tsx QueryLog.tsx` | empty |

## Done Criteria Coverage

- Done Criteria 11 항목 + AC 13 항목 전부 충족. 상세 매핑은 `findings.md` 참조.

## Assumptions

- **Document in-place restore 는 active tab 의 `database`/`collection` 을 보존** — entry 의 db/coll 은 "new tab spawn" 경로에서만 소비. 사용자가 현재 collection context 에서 작업 중일 때 같은 paradigm 의 entry 를 load 해도 focus 된 collection 이 바뀌지 않도록. execution-brief 에 명시한 의도적 결정.
- **Legacy entry 정규화는 read-path 에서 수행** — `filteredGlobalLog` 가 `.map(normaliseEntry)` 로 rdb/sql default 를 주입. Sprint 85 이후 persist 레이어가 도입되면 deserialize path 에 같은 normalize 를 넣어 기존 localStorage 데이터도 자동 마이그레이션 가능.
- **QueryLog.test.tsx / GlobalQueryLogPanel.test.tsx 의 TS compile fix 는 test scope 로 허용** — contract 의 "절대 수정 금지" 목록은 source (`.tsx`) 만 명시, 대응 test 파일은 test 영역. Renderer 소스는 diff 0.
- **Defensive default 2 layer** — (1) store `addHistoryEntry` 가 쓰기 시 default 주입, (2) consumer `handleLoad` 가 읽기 시 `entry.paradigm ?? "rdb"` 재default. 두 layer 가 legacy in-memory vs legacy persisted 양쪽 상황을 모두 방어.

## Residual Risk

- **`loadQueryIntoTab(rdb, aggregate)` 이론적 drift** — 만약 caller 가 `paradigm: "rdb"` + `queryMode: "aggregate"` 조합을 넘기면 `addQueryTab` 의 RDB 가드 (tabStore.ts:306-307) 가 `queryMode` 를 `"sql"` 로 강제. 현재 모든 caller 는 실제 tab/entry 상태에서 파생되므로 이 조합이 발생 불가. P3 finding 으로 기록.
- **`canInPlace` 의 database/collection 매칭 무시** — 현재는 paradigm + connectionId 만 비교. 사용자가 collection A 를 보면서 collection B 의 entry 를 load 해도 같은 tab 이 in-place update 됨 (sql + queryMode 만 교체, db/coll 은 tab 측 유지). 사용자 흐름 관점에서 의도적이지만, Sprint 85 이후 UX 검토 대상.
- **compile-fix 대상 test 파일의 Sprint 85 재작업** — Sprint 85 renderer 변경 시 QueryLog / GlobalQueryLogPanel 테스트를 재정렬할 예정이므로 paradigm 필드 주입은 일시적 패치.

## Follow-up

- Sprint 85 (history viewer highlighting) — entry 의 `paradigm` 필드를 직접 소비해 SqlSyntax / MongoSyntax 분기. `cm-mql-operator` class 와 `MONGO_ALL_OPERATORS` 를 재사용.
- 인라인 편집 + MQL Preview + Add/Delete (task #5, Phase 6 plan F) — Sprint 85 이후 진행.
- `loadQueryIntoTab` 의 branch-count 문서 통일 (P3 cosmetic).
- `addQueryTab` 의 rdb+non-sql 조합 방어 로직 추가 (P3 hardening, 필요시).
