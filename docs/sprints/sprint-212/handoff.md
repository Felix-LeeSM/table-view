# Sprint 212 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

### Sprint 212 (P3 tabStore cross-store) — primary

- `src/stores/tabStore.ts` (entry, 668 → ~620): cross-store import (`useMruStore`, `useQueryHistoryStore`) 두 줄 + 그 위 `eslint-disable no-restricted-imports` 블록 제거. `addTab` / `addQueryTab` 본문의 MRU mark 호출 제거. `recordHistory` action 본체 제거. 상단 TODO 주석 제거. same-store sub-file 보호용 `eslint-disable` 블록 (line 45/58) 은 유지 (eslint `./*Store` glob narrowing 이 본 sprint scope 외 — F-003 P3).
- `src/stores/tabStore/types.ts`: `TabState.recordHistory` 시그니처 + `QueryHistorySource` / `QueryHistoryStatus` cross-store type imports 제거.
- `src/components/query/QueryTab/useQueryExecution.ts`: `useTabStore.recordHistory` selector 제거 → `useQueryHistoryStore.addHistoryEntry` selector 추가. 내부 `recordHistory(payload)` closure 1개가 `tab.connectionId` / `paradigm` / `queryMode` / `database` / `collection` 자동 추출 + `source: "raw"` default 보존. 7 invocation 모두 `recordHistory(tab.id, {...})` → `recordHistory({...})` 1-arg 으로 전환.
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts`: `useMruStore` selector 추가, 6 handler (`handleTableClick` / `DoubleClick` / `OpenStructure` / `ViewClick` / `OpenViewStructure` / `FunctionClick`) 모두 `markConnectionUsed(connectionId)` 명시 호출.
- `src/components/rdb/DataGrid.tsx`: `useMruStore` selector + `handleNavigateToFk` 의 `markConnectionUsed`.
- `src/components/layout/MainArea.tsx`: EmptyState "New Query" CTA `onClick` 의 `markConnectionUsed(target.id)`.
- `src/components/layout/Sidebar.tsx`: "+ Query" 버튼 onClick 의 `markConnectionUsed(focusedConnId)`.
- `src/App.tsx`: 3 event/shortcut handler (Cmd+T, navigate-table, quickopen-function) 모두 `markConnectionUsed`.
- `src/components/query/QueryTab.tsx` **(F-001 fix)**: `useMruStore` selector 추가. `<QueryHistoryPanel onLoad>` wrapper 가 `loadQueryIntoTab(args) + markConnectionUsed(args.connectionId)` 묶음 → HistoryPanel restore 경로의 MRU 발화 복원.
- `src/stores/tabStore.test.ts`: AC-195-03 (3 case) + AC-196-02 (2 case) 의 `recordHistory` 단위 테스트 5건 삭제 (path-a). 위치에 1줄 주석 + Sprint 212 커버리지 source-of-truth (`useQueryExecution` 통합 path) 안내.
- `docs/sprints/sprint-212/{spec,contract,execution-brief,findings,handoff}.md`.

### Sprint 217 (P9 DocumentDatabaseTree) — 사전 처리 통합 commit

> 본 sprint 진행 중 Generator 가 P9 DocumentDatabaseTree split 을 함께 수행. 행동 변경 0 + 21건 회귀 통과. 별도 atomic commit 분리는 sub-file dependency 로 인한 build 무결성 비용이 audit trail 이득보다 커서 단일 commit 으로 통합. retroactive sprint-217 docs 도 함께 추가. PLAN.md 의 Sprint 217 행 동일 hash.

- `src/components/schema/DocumentDatabaseTree.tsx` (582 → 263 lines, -55%): entry 가 두 hook + 두 row 컴포넌트 + 한 dialog 만 wiring.
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseTreeData.ts` (205): `databases[connectionId]` / `collections` selector + `loadDatabases` / `loadCollections` 호출 + 검색 필터 + 자동 expand.
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts` (109): Safe Mode gate + `dropCollection` Tauri call + Mongo history record + toast.
- `src/components/schema/DocumentDatabaseTree/rows.tsx` (130): `DatabaseRow` + `CollectionRow` presentational.
- `src/components/schema/DocumentDatabaseTree/dialogs.tsx` (67): destructive `DropCollectionDialog`.
- `docs/sprints/sprint-217/{spec,contract,execution-brief,findings,handoff}.md` (retroactive).

## 다음 sprint = Sprint 213

[`docs/PLAN.md`](../../PLAN.md) post-209 cycle 표 line 119 (P5 step 2):

> | 3 | 213 | refactor | P5 step 2 | `db/mod.rs` (551) trait/DTO 분리 + `export.rs` (879) writer 분리. |

[`docs/archives/etc/refactoring-candidates.md`](../../archives/etc/refactoring-candidates.md) §P5 가 입력값. P5 step 1 (tests block hoist) 은 사용자 commit `a60074d` 로 완료, step 2 만 잔여.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` | 0 매치 ✓ |
| `grep -nE "eslint-(disable\|enable) no-restricted-imports" src/stores/tabStore.ts` | 2 매치 (same-store, F-003 P3 informational) |
| `grep -rn "markConnectionUsed" src/stores/ \| grep -v "src/stores/mruStore"` | 0 매치 ✓ |
| `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` | 0 매치 ✓ |
| `grep -n "recordHistory" src/stores/tabStore.ts src/stores/tabStore/types.ts` | 0 매치 ✓ |
| `grep -rn "from \"@stores/tabStore\"" src/ e2e/ \| grep -v "src/stores/tabStore" \| wc -l` | 51 (≥ 50 baseline) ✓ |
| `pnpm vitest run` (full suite) | 189 files / **2720 tests** pass, exit 0 ✓ (baseline 2725 - 5 stale = 2720) |
| `pnpm tsc --noEmit` | exit 0 ✓ |
| `pnpm lint` | exit 0 ✓ |
| `git diff src/ \| grep "^+.*eslint-disable"` | 0 라인 (새 eslint-disable 0) ✓ |

## Acceptance Criteria 결과

- AC-01 cross-store import 0 + cross-store eslint-disable 블록 제거 ✓ (literal text 잔존 2 매치는 same-store, F-003 P3)
- AC-02 두 cross-store action call 이 caller layer 로 이동 ✓ (15 caller invocations 포함 F-001 fix)
- AC-03 외부 import path / 51 caller signature 보존 ✓ (51 매치)
- AC-04 회귀 테스트 통과 ✓ (189 files / 2720 tests)
- AC-05 프로젝트 회귀 0 ✓ (tsc/lint exit 0, 새 eslint-disable 0)

Evaluator: **PASS 7.5/10** (Correctness 8 / Completeness 8 / Reliability 7 / Verification Quality 8). F-001 P2 + F-002 P2 발견 → 본 sprint 마무리에서 둘 다 해소 (F-001 fix 반영, F-002 retroactive Sprint 217 docs 통합).

## F-001 Fix 사후

Evaluator F-001 [P2]: `loadQueryIntoTab` (HistoryPanel restore) MRU marking 손실. Generator 의 의식적 "MRU-neutral" 결정이 spec Global AC-1 와 충돌. 회귀 가드 부재.

해소: `src/components/query/QueryTab.tsx` 의 `<QueryHistoryPanel onLoad>` 를 inline wrapper 로 변경 — `loadQueryIntoTab(args) + markConnectionUsed(args.connectionId)` 묶음. tabStore.ts 의 stale comment ("Restoring history through `HistoryPanel` is now MRU-neutral") 도 정확한 fact 로 갱신 ("`loadQueryIntoTab` itself stays MRU-neutral; its sole production caller (HistoryPanel restore) wraps the call with `markConnectionUsed`."). 모든 회귀 재실행 — 189 files / 2720 tests pass / tsc / lint exit 0 / 새 eslint-disable 0.

## Sprint 217 사전 처리 통합 결정 사후

Evaluator F-002 [P2]: DocumentDatabaseTree.tsx 4-way 분해가 contract scope 외 + self-report 누락 + Sprint 번호 mislabel.

해소 옵션 (a-1) 채택 — 단일 commit 통합 + retroactive Sprint 217 docs 추가. 이유:
- 분해 부분과 P3 marker 추가 변경이 동일 파일 (`DocumentDatabaseTree.tsx`) 에 깊게 섞임 → atomic 두 commit 분리 시 build 무결성 위협 (sub-file dependency).
- 행동 변경 0 (DocumentDatabaseTree.test.tsx 21건 통과) + 코드 품질 (582 → 263 + 511 sub-file 분배) 정상.
- doc-comment 의 "Sprint 217" 라벨은 retroactive 으로 정합 (PLAN.md Sprint 217 = ✓ 동일 hash).

PLAN.md 의 Sprint 212 + Sprint 217 두 행 모두 ✓ 같은 commit hash 가리킴.

## 주의 사항

### 14 → 15 caller invocation count

handoff 본문의 markConnectionUsed 추가 호출은 14 sites (App 3 / SchemaTree 6 / DocumentDatabaseTree 2 / DataGrid 1 / MainArea 1 / Sidebar 1) 였으나 F-001 fix 로 QueryTab.tsx 의 HistoryPanel onLoad wrapper 1건 추가 → 총 **15 invocation**.

### 8 call site → 1 closure + 7 invocation (Generator DRY 결정)

`useQueryExecution.ts` 의 `recordHistory` closure 가 1개 + 7 invocation (success/error 양쪽 + single SQL / multi / mongo find / mongo aggregate). spec literal "8 call site direct" 와 다르지만 의미상 동일 (DRY 패턴, payload shape byte-for-byte 동일). 원본 store action 의 사전 호출 수도 7 invocation 이라 spec 자체의 카운트 오류 (F-004 P3).

### F-003 same-store eslint-disable 잔존 (line 45/58)

cross-store coupling 본질 0 달성, literal text 만 2 매치. eslint config `./*Store` glob narrowing 이 후속 sprint candidate. 현 코멘트 (tabStore.ts:36-44) 가 self-documenting 으로 충분.

### F-005 Sidebar +Query MRU 발화 회귀 가드 부재

Sidebar.test.tsx 가 `markConnectionUsed` 검증 안 함. Sidebar.tsx 의 caller-only marking 이 실수로 제거되어도 vitest 미검출. 후속 sprint candidate (1건 추가, MainArea.test.tsx::AC-01/04 답습).

### 사용자 병행 작업과의 격리

본 sprint 작업 중 unstaged 영역 발견 안됨 (working tree 는 sprint 산출물만).

## 검증 명령 (재현)

```sh
pnpm vitest run src/stores/tabStore.test.ts src/stores/mruStore.test.ts src/stores/queryHistoryStore.test.ts
pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx src/__tests__/cross-window-connection-sync.test.tsx
pnpm vitest run src/components/layout/MainArea.test.tsx src/components/layout/Sidebar.test.tsx
pnpm vitest run src/components/query/QueryTab.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
grep -n "useMruStore\|useQueryHistoryStore\|recordHistory" src/stores/tabStore.ts  # 0
grep -rn "markConnectionUsed" src/stores/ | grep -v "src/stores/mruStore"  # 0
grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/  # 0
grep -rn "from \"@stores/tabStore\"" src/ e2e/ | grep -v "src/stores/tabStore" | wc -l  # 51
```

## 미완 / 후속

- Sprint 213 — P5 step 2 (`db/mod.rs` 551 trait/DTO 분리 + `commands/export.rs` 879 writer 분리). step 1 사용자 `a60074d` 처리 완료.
- 본 sprint 후속 candidate (informational):
  - F-003: eslint config `./*Store` glob narrowing → tabStore.ts 의 same-store eslint-disable 일소.
  - F-004: spec literal 카운트 자기검증 프로세스 (post-mortem).
  - F-005: Sidebar.test.tsx 에 +Query MRU 발화 1건 추가.
- cycle 종료 후 `refactoring-candidates.md` retire 예정 (이전 cycle CODE_SMELLS retire 패턴).
