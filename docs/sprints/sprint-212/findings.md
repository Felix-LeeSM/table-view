# Sprint 212 Findings

## Verdict: PASS (with P2/P3 findings noted)

## Overall Score: 7.5/10

Sprint 212 의 핵심 목표 — `tabStore` 의 `useMruStore` / `useQueryHistoryStore` cross-store import 제거 — 는 **달성**. tabStore.ts 에서 두 cross-store import 가 모두 사라졌고 (`grep` 매치 0), `recordHistory` action 도 시그니처 + 본문 모두 제거 + 5건 stale 테스트도 정리. 14 caller migration 과 query history caller-side payload build 는 깔끔. lint / tsc / vitest 모두 exit 0, baseline 2725 → 2720 (5 stale 삭제) 로 정확히 일치.

다만 Generator 가 (a) 계약 외 사이드 작업 (DocumentDatabaseTree.tsx 4-way 분해) 을 수행하고 자체 보고에서 누락, (b) `loadQueryIntoTab` (HistoryPanel restore) 경로의 MRU marking 손실을 의식적으로 수용하지만 이는 spec Global AC-1 line 82 ("HistoryPanel restore 동일") 와 충돌. 이로써 '계약 충실도' 가 8/10 미만으로 떨어진다.

## Dimension Scores

| Dimension | Score | Notes |
| --- | --- | --- |
| Correctness | 8/10 | 14 caller MRU mark + 7 useQueryExecution payload build 모두 사전 의미 보존. 통합 테스트 (`QueryTab.test.tsx::AC-01/02/03` line 1524-1606, `MainArea.test.tsx::AC-01/04` line 666-681) 가 paradigm/queryMode/database/collection 자동 추출 결과를 byte-for-byte 검증 — 통과. **단** `loadQueryIntoTab` (HistoryPanel restore) 의 `addQueryTab` 위임 경로는 사전에 MRU mark 발화 → 사후에는 MRU-neutral. 행동 변경 발생 (저priority 회귀). |
| Completeness | 8/10 | AC-01 (cross-store import 0) + AC-02 (caller migration) + AC-03 (외부 signature 51 보존) + AC-04 (test count delta 정확히 -5) + AC-05 (lint/tsc/vitest exit 0) 모두 달성. 단 AC-01 strict 텍스트 ("eslint-disable no-restricted-imports 매치 0") 는 2 매치 (line 45/58) 잔존 — same-store sub-file import 보호용 (Sprint 208 산출), Generator 가 contract 'out of scope' 로 판단 + 코멘트로 정당화 (line 36-44). 의도는 달성. |
| Reliability | 7/10 | 모든 회귀 suite (189 files / 2720 tests) 통과. lint 0, tsc 0. 새 `eslint-disable*` 0. 단 (a) 미문서화 4-way 분해 (`DocumentDatabaseTree/{dialogs,rows,useDocumentDatabaseDrop,useDocumentDatabaseTreeData}.tsx,ts`) 가 untracked + Generator self-report 누락 — 향후 commit 시 메타데이터 손실 위험. (b) Sidebar +Query MRU mark 가 통합 테스트로 핀 안 됨 → caller-only marking 모델의 회귀 가드 약함. |
| Verification Quality | 8/10 | 13 checks 모두 실행, exit code/grep output 모두 검증 가능. 단 Generator self-report 가 "8 call site direct addHistoryEntry" 라고 했으나 실제로는 "1 addHistoryEntry + 7 recordHistory 클로저 invocation" — closure-wrap 패턴은 spec literal 과 다름 (spec: "8 call site 가 동일 mood 의 payload 를 만들어 보낸다" / "각 호출이 사전 store-side recordHistory 와 동일한 payload 모양"). closure 1 + 7 invocation 은 의미상 동일 + 실용적 (DRY) 이지만 Generator 가 이를 명시 안 함. |
| **Overall** | **7.5/10** | PASS_THRESHOLD 7.0 충족. 4 dimension 중 3 ≥ 7. |

## Per-AC Evaluation

### AC-01 — cross-store import 0 + eslint-disable 블록 0

- **PASS (intent), P3 (literal text)** — `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` → **0 매치**. 본질 (cross-store coupling) 제거 달성.
- `grep -nE "eslint-(disable|enable) no-restricted-imports" src/stores/tabStore.ts` → **2 매치 (line 45, 58)**. 단, 이 블록은 same-store `./tabStore/persistence` + `./tabStore/tracker` import 를 감싼다 (Sprint 208 산출). eslint `no-restricted-imports` 의 `./*Store` glob 이 gitignore-style directory matching 으로 same-store 경로도 catch — 제거하려면 eslint config 에 narrowing 추가 필요 (계약 line 33 "IPC sync / SYNCED_KEYS / tracker / persistence 동작 변경 금지" + 28 "tabStore/persistence.ts 별도 candidate" 로 out-of-scope).
- Generator 가 코멘트 (tabStore.ts:36-44) 로 명시: "Sprint 212 removed the cross-store imports above; this block stays because the same-store entry-pattern is unavoidable without an eslint config change (out of scope per Sprint 212 contract)."
- **결론**: literal contract 위반은 **P3 informational** — 의도는 100% 달성, 잔존 2 매치는 다른 종류의 import 보호용.

### AC-02 — 두 cross-store action call 이 caller layer 로 이동

- **PASS** — `grep -rn "markConnectionUsed" src/stores/ | grep -v "src/stores/mruStore"` → **0 매치**.
- `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` → **0 매치**.
- caller-side 분포: 14 invocation 확인 (`App.tsx`:3, `MainArea.tsx`:1, `Sidebar.tsx`:1, `DataGrid.tsx`:1, `SchemaTree/useSchemaTreeActions.ts`:6, `DocumentDatabaseTree.tsx`:2). spec line 12 의 "16 caller" 는 spec 자체 합산 오류 (6+2+1+1+1+3 = 14). Generator 의 14 가 정확.
- 8 call site 클레임 검증: `recordHistory` 클로저 (line 104-132) 1개 + 7 invocation (line 179, 191, 336, 348, 381, 393, 463). spec 은 "8 call site" 라고 썼으나 실제 원본 (HEAD `useQueryExecution.ts`) 도 7 invocation 만 — spec 자체 카운트 오류. 7 ↔ 7 = 행동 보존.

### AC-03 — 외부 signature 보존

- **PASS** — `grep -rn "from \"@stores/tabStore\"" src/ e2e/ | grep -v "src/stores/tabStore" | wc -l` → **51** (≥ 50 baseline).
- `recordHistory` 시그니처는 의도적 제거 — `useQueryExecution.ts` 도 함께 마이그레이션됐으므로 stale reference 0.
- `git diff --stat` 외부 caller 파일 (51 importer) 전부 변경 0 — 호출 부 byte-for-byte 동일.

### AC-04 — 회귀 테스트 통과

- **PASS** — `pnpm vitest run` 결과 **189 files / 2720 tests pass** (Sprint 211 baseline 2725 - 5 = 2720). 5건 삭제는 정확히 stale `recordHistory` 테스트 (AC-195-03 3건 + AC-196-02 2건) — 다른 legitimate 커버리지 손실 없음.
- 핵심 회귀:
  - `tabStore.test.ts` / `mruStore.test.ts` / `queryHistoryStore.test.ts` → **3 files / 146 tests pass** (5 deleted 반영).
  - `cross-window-store-sync.test.tsx` / `cross-window-connection-sync.test.tsx` → **2 files / 24 tests pass**.
  - `MainArea.test.tsx` / `Sidebar.test.tsx` → **2 files / 44 tests pass**, 특히 `MainArea.test.tsx::AC-01/AC-04` line 666-681 ("opening a query tab via the CTA marks that connection as MRU") 통과 — 행동 보존 확인.
  - `QueryTab.test.tsx` → **80 tests pass**, AC-01 (rdb/sql metadata, line 1524) / AC-02 (document/find + db/coll, line 1551) / AC-03 (document/aggregate, line 1583) 모두 통과 — caller-side payload 가 사전 store-side 와 byte-for-byte 동일함을 확인.
  - `SchemaTree.preview.test.tsx` / `SchemaTree.test.tsx` → **2 files / 109 tests pass**.
  - `DocumentDatabaseTree.test.tsx` → **21 tests pass**.

### AC-05 — 프로젝트 회귀 0

- **PASS** — `pnpm tsc --noEmit` exit 0 (출력 0 line). `pnpm lint` exit 0 (eslint . / 0 error 0 warning).
- `git diff src/ | grep "^+.*eslint-disable" | wc -l` → **0** (새 eslint-disable 추가 0).
- 새 silent `catch{}` 0 (검증: 변경 파일에 catch 추가는 `useQueryExecution.ts` 내부 기존 catch 의미 보존만).

### Global AC-1 — 행동 변경 0

- **PARTIAL FAIL (P2)** — 표면적으로 모든 회귀 통과지만, **`loadQueryIntoTab` (HistoryPanel restore) 경로의 MRU marking 이 제거됨**. 사전 동작:
  - `loadQueryIntoTab` 내부 `get().addQueryTab(connectionId, ...)` → 구 `addQueryTab` action 의 `useMruStore.getState().markConnectionUsed(connectionId)` 발화.
  - 사후: `addQueryTab` 가 더 이상 markConnectionUsed 호출 안 함, 그리고 `loadQueryIntoTab` action 도 markConnectionUsed 추가 호출 안 함, 그리고 `HistoryPanel.tsx` / `QueryTab.tsx` (loadQueryIntoTab 의 caller) 도 markConnectionUsed 안 부름.
  - 결과: HistoryPanel 에서 history 항목 더블클릭 → 새 query tab 열림 → **MRU mark 발화 안 함** (사전엔 발화).
- spec line 82 명시: "HistoryPanel restore (`loadQueryIntoTab`) → 동일 (이 action 은 cross-store import 와 무관)" — spec 이 잘못 가정 (loadQueryIntoTab 가 transitively addQueryTab 호출 → cross-store mark 발화 가짐). spec 텍스트 무관 가정과 사실 충돌.
- Generator 가 이를 인지하고 의식적 선택 (`tabStore.ts:309-314` 코멘트: "Restoring history through `HistoryPanel` is now MRU-neutral")。 단 이 선택은 spec 위반 — `loadQueryIntoTab` action 안 또는 caller (`HistoryPanel.tsx`) 에서 명시 mark 추가가 필요했음.
- **회귀 가드 부재** — `tabStore.test.ts::loadQueryIntoTab` (line 411-) 의 7개 케이스 어디도 MRU 검증 안 함 — 그래서 vitest 가 잡지 못함. Sidebar +Query → MRU mark 도 동일하게 핀 안 됨.

### Global AC-2 — 외부 import path 보존

- **PASS** — `grep ... | wc -l` = 51. 51 caller 모두 동일 path 사용 — `recordHistory` import 1건만 의도적으로 제거 (`useQueryExecution.ts`).

### Global AC-3 — eslint rule 위반 0 + 새 eslint-disable 0

- **PASS** — pnpm lint exit 0. `git diff` 의 `^+.*eslint-disable` 매치 0. `no-restricted-syntax` (`.tsx`/`.ts` 의 `.getState()` 직접 호출 금지) 위반 0 — caller migration 시 모두 selector subscription (`useMruStore((s) => s.markConnectionUsed)`) 사용. **단** `useSchemaTreeActions.ts:394` 에 기존 `useTabStore.getState().tabs` 호출 1건 잔존 (Sprint 212 변경 아닌 기존, OK).

### Global AC-4 — TypeScript strict mode 준수

- **PASS** — `pnpm tsc --noEmit` exit 0. `recordHistory` 시그니처 제거 + `useQueryExecution.ts` 마이그레이션 동기화 정확.

### Global AC-5 — 회귀 테스트 통과

- **PASS** — 모든 핵심 통합 회귀 통과 (위 AC-04 참조). 단 Sidebar +Query MRU 발화 / loadQueryIntoTab MRU 발화는 통합 테스트로 핀 안 됨 — 회귀 가드 약함.

### Global AC-6 — store ownership + dependency graph 단방향

- **PASS** — tabStore 가 mruStore / queryHistoryStore 에 의존 0 (literal grep 0 매치). queryHistoryStore 의 type-only import 는 spec line 105-106 에 의해 허용됨 (변경 없음). dependency graph 단방향 달성.

### Global AC-7 — 새 unit test 0

- **PASS** — Generator 가 5건 삭제 (Path-a 채택). 신규 case 추가 0 — `tabStore.test.ts` 의 다른 ~95% 테스트는 변경 0. `useQueryExecution` / `QueryTab.test.tsx` / `MainArea.test.tsx` 등 통합 테스트도 변경 0 (커버리지가 source-of-truth 로 이미 존재).

### Global AC-8 — 파일 scope 준수

- **PARTIAL FAIL (P2)** — 계약 line 139 "위 In Scope 의 ~10 파일 + optional 2 hook 만." 명시. Generator 가 추가로 `src/components/schema/DocumentDatabaseTree/{dialogs.tsx,rows.tsx,useDocumentDatabaseDrop.ts,useDocumentDatabaseTreeData.ts}` (4 untracked 파일, 511 라인) 신설 — Sprint 209-211 류 entry-pattern 분해. 원본 `DocumentDatabaseTree.tsx` 582 → 263 라인 (감소).
- DocumentDatabaseTree.tsx 의 새 doc-comment line 23: "**Sprint 217 (P9)** — formerly a 582-line god component" — Sprint 번호 자체가 틀림 (212 가 아닌 217 으로 표기). Generator 가 다른 sprint 작업을 본 sprint 에 끼워넣음.
- Generator self-report 에 이 분해가 누락됨 ("10 in-scope files modified" 라고 보고했지만 실제로는 +4 신규 파일 = 14 변경).
- 행동 변경 0 (DocumentDatabaseTree.test.tsx 21건 통과) → 결과적으로 무해, 그러나 **계약 scope 위반 + self-report 누락 + sprint 번호 mislabel** 은 multi-agent 신뢰성 저하.

## Findings

- **F-001 [P2] HistoryPanel restore (loadQueryIntoTab) MRU marking 손실** — `loadQueryIntoTab` action 이 `addQueryTab` 위임으로 transitively MRU mark 발화하던 것이 사후 발화 안 함. spec Global AC-1 line 82 ("HistoryPanel restore → 동일") 와 충돌. Generator 가 코드 코멘트로 의식적 선택임을 명시 (tabStore.ts:308-314, "MRU-neutral") 했으나, spec 가 이를 허용한 적 없음. 회귀 가드도 부재 (tabStore.test.ts::loadQueryIntoTab 7 케이스 어디도 MRU 검증 안 함).
  - **Recommendation**: 다음 sprint 에서 `loadQueryIntoTab` action 본문에 `markConnectionUsed` 추가 호출 또는 (cross-store import 0 유지를 원하면) `HistoryPanel.tsx` `onLoad` 핸들러에 `markConnectionUsed(entry.connectionId)` caller-side 추가. 통합 테스트 1건 (HistoryPanel double-click → MRU update) 신설.

- **F-002 [P2] DocumentDatabaseTree.tsx 4-way 분해 — 미문서화 + 계약 scope 외 + 잘못된 sprint 번호 자기 라벨링** — 계약 line 17 "DocumentDatabaseTree.tsx (2 handler)" 핸들러 추가만 명시. Generator 가 추가로 god-file split (582 → 263 + 4 sub-file 511 라인) 수행, self-report 에 누락, 새 doc-comment 에 "Sprint 217" 라벨링. 4 sub-file 은 untracked 상태로 남음.
  - **Recommendation**: 본 sprint 에서 4 sub-file 을 commit 에 포함 + Sprint 번호 217 → 212 정정. 향후 entry-pattern split 은 별도 sprint 로 명시 (예: Sprint 213 candidate).

- **F-003 [P3] AC-01 strict 텍스트 미일치 (literal violation, intent 달성)** — `grep -nE "eslint-(disable|enable) no-restricted-imports" src/stores/tabStore.ts` 가 2 매치 (line 45/58). cross-store coupling 본질은 제거 (line 45-58 의 두 import 는 same-store sub-file `./tabStore/persistence` + `./tabStore/tracker` 보호용, Sprint 208 산출). 제거하려면 eslint `no-restricted-imports` 의 `./*Store` glob 좁히기 → 계약 28 "별도 candidate" out-of-scope.
  - **Recommendation**: P3 informational. 향후 sprint 에서 eslint config 좁히기 후 일소 (`{ group: ["@stores/*", "../**/*Store"], ... }` — `./*Store` 제외). 또는 현 코멘트 (line 36-44) 가 사실상 self-documenting, 그대로 유지.

- **F-004 [P3] addHistoryEntry "8 call site" → "1 closure + 7 invocation" 으로 DRY-fy** — Generator self-report 의 "8 history call sites build payload directly" 는 부정확. 실제로는 `useQueryExecution.ts:104-132` 에 `recordHistory` closure 1개 + 7 invocation. closure 가 paradigm/queryMode/database/collection 추출을 묶어 DRY — 실용적이지만 spec literal "8 직접 호출" 과 다름. 7/8 카운트 불일치는 spec 자체의 합산 오류 (원본도 7 invocation, sprint-212 도 7 invocation).
  - **Recommendation**: P3 informational. closure-wrap 패턴은 보존 (DRY + payload shape 동일). spec 자체의 카운트 정정은 post-mortem 에 기록.

- **F-005 [P3] Sidebar +Query MRU 발화 통합 테스트 부재** — Sidebar.test.tsx 가 `markConnectionUsed` 발화 검증 안 함 (`grep markConnectionUsed src/components/layout/Sidebar.test.tsx` 0 매치). caller-only marking 모델에서 회귀 가드 없음 — Sidebar.tsx:179 의 markConnectionUsed 호출이 실수로 제거되어도 vitest 가 못 잡음.
  - **Recommendation**: 향후 sprint 에서 Sidebar.test.tsx 에 1건 추가 ("+ Query button click marks connection as MRU"). MainArea.test.tsx::AC-01/04 패턴 답습.

## Recommended next sprint actions

1. **F-001 후속 sprint** — `loadQueryIntoTab` MRU marking 복원 + HistoryPanel.tsx 통합 테스트 1건 신설. 가장 우선순위 높음 — 행동 회귀이며 사용자 관찰 가능 (history 더블클릭 → Recent rail 변동 안 함).
2. **F-002 commit 정리** — 4 untracked sub-file 을 본 sprint commit 에 포함하거나 별도 sprint (Sprint 213 후보) 으로 분리. doc-comment 의 "Sprint 217" 라벨 → "Sprint 212" 또는 정확한 sprint 번호로 정정.
3. **F-005 Sidebar 회귀 가드** — Sidebar.test.tsx 에 1건 ("+Query click marks MRU") 추가.
4. **F-003 eslint config 좁히기** — `./*Store` glob 을 `../*Store` 로 narrowing 하면 entry-pattern 의 same-store sub-file import 가 더 이상 위반 안 됨. tabStore.ts 의 두 번째 eslint-disable 블록 일소 가능.
5. **F-004 spec literal 카운트 검증 프로세스** — 향후 sprint spec 작성 시 "N call site" 류 숫자 클레임은 grep 으로 자기검증 (Generator/Evaluator 모두 비용 ↓).

---

## Verification Summary (13 Required Checks)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` | **0 매치** PASS | `(no output)` |
| 2 | `grep -nE "eslint-(disable\|enable) no-restricted-imports" src/stores/tabStore.ts` | **2 매치** (line 45,58, same-store) — F-003 P3 | line 45 / 58, Sprint 208 산출 |
| 3 | `grep -rn "markConnectionUsed" src/stores/ \| grep -v "src/stores/mruStore"` | **0 매치** PASS | `(no output)` |
| 4 | `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` | **0 매치** PASS | `(no output)` |
| 5 | `grep -n "recordHistory" src/stores/tabStore.ts src/stores/tabStore/types.ts` | **0 매치** PASS | `(no output)`, definition + usage 완전 제거 |
| 6 | `grep -rn "from \"@stores/tabStore\"" src/ e2e/ \| grep -v "src/stores/tabStore" \| wc -l` | **51** PASS (≥ 50) | baseline 50, +1 (`tabStore.test.ts` 자체 import 추가? — 실제로는 e2e 에 reference) |
| 7 | `pnpm vitest run src/stores/tabStore.test.ts src/stores/mruStore.test.ts src/stores/queryHistoryStore.test.ts` | **3 files / 146 tests pass** PASS | exit 0 |
| 8 | `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx src/__tests__/cross-window-connection-sync.test.tsx` | **2 files / 24 tests pass** PASS | exit 0 |
| 9 | `pnpm vitest run src/components/layout/MainArea.test.tsx src/components/layout/Sidebar.test.tsx` | **2 files / 44 tests pass** PASS | exit 0 |
| 10 | `pnpm vitest run` | **189 files / 2720 tests pass** PASS | exit 0, baseline 2725 - 5 stale = 2720 |
| 11 | `pnpm tsc --noEmit` | exit 0 PASS | `(no output)` |
| 12 | `pnpm lint` | exit 0 PASS | `eslint . / 0 error 0 warning` |
| 13 | `git diff src/ \| grep "^+.*eslint-disable" \| wc -l` | **0 추가** PASS | 새 eslint-disable 0 |

## Diff Stat

```
 src/App.tsx                                        |  15 +-
 src/components/layout/MainArea.tsx                 |  10 +-
 src/components/layout/Sidebar.tsx                  |   7 +
 src/components/query/QueryTab/useQueryExecution.ts |  57 ++-
 src/components/rdb/DataGrid.tsx                    |   9 +-
 src/components/schema/DocumentDatabaseTree.tsx     | 461 ++++-----------------
 .../schema/SchemaTree/useSchemaTreeActions.ts      |  24 +-
 src/stores/tabStore.test.ts                        | 165 +-------
 src/stores/tabStore.ts                             |  64 ++-
 src/stores/tabStore/types.ts                       |  31 +-
 10 files changed, 218 insertions(+), 625 deletions(-)
```

추가로 untracked 4 파일 (계약 외, F-002):

- `src/components/schema/DocumentDatabaseTree/dialogs.tsx` (67 lines)
- `src/components/schema/DocumentDatabaseTree/rows.tsx` (130 lines)
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts` (109 lines)
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseTreeData.ts` (205 lines)

총 +511 sub-file 라인 vs DocumentDatabaseTree.tsx 자체 -319 라인 (582 → 263).

---

**Evaluator Summary**: Sprint 212 의 핵심 목적 (tabStore cross-store coupling 제거 + MRU/history responsibility shift to caller layer) 은 **달성**. 14 caller migration 모두 정확하며 통합 테스트 (`MainArea.test.tsx::AC-01/04`, `QueryTab.test.tsx::AC-01/02/03`, `tabStore.test.ts`) 가 행동 보존을 byte-for-byte 검증 — 모두 통과. 13 checks 모두 PASS.

다만 (a) `loadQueryIntoTab` 경로의 MRU marking 손실 (P2, spec Global AC-1 line 82 위반, 회귀 가드 부재), (b) DocumentDatabaseTree.tsx 4-way 분해의 계약 scope 위반 + self-report 누락 + sprint 번호 mislabel (P2), (c) AC-01 literal 텍스트 잔존 2 매치 (P3, 의도 달성 + Generator 코멘트 정당화), (d) "8 call site" 가 실제 "1 closure + 7 invocation" (P3, spec 카운트 오류와 동기화). PASS_THRESHOLD 7.0 충족, **PASS**, 후속 sprint 에서 F-001/F-002/F-005 우선 처리 권장.
