# Sprint 272 — Phase 26 (Trigger Read) Evaluator Findings

**Attempt 2 결과: PASS** (overall 8.6/10)

## Scorecard (attempt 2)

| Dimension | Score |
| --- | --- |
| Correctness | 9/10 |
| Test coverage | 9/10 |
| Contract adherence | 9/10 |
| Code quality | 8/10 |
| Robustness | 8/10 |
| **Overall** | **8.6/10** |

Attempt 1 대비 Contract adherence 6 → 9. AC-272-06 literal compliance + P2a/P2b 리그레션 가드 추가로 게이트 통과.

## Resolved between attempts

- **AC-272-06 literal compliance** — 각 Table row 하위에 child "Triggers" row를 렌더. group expansion 시 lazy-fetch, 재펼침 시 캐시 히트 (재요청 없음). 1차에서 누락됐던 placeholder/loading state도 함께 수렴.
- **P2a — `decode_tgargs` embedded single-quote test** — `b"O'Brien\0"` 등 escape edge-case를 backend 테스트로 고정.
- **P2b — `clearSchema` triggers eviction regression test** — `schemaStore.test.ts`에 `triggers` slice가 `clearSchema(connId, db)` 경로에서 함께 evict 되는지 단언하는 케이스 추가.

## Residual P2s (Sprint 273+ 로 이월)

### 1. Render-path duplication (collapse before Sprint 273)

`body.tsx::TriggerGroupSubtree` (lines 536–660) 와 `treeRows.ts::buildTriggerRowsForTable` (lines 563–661) 가 동일한 branching logic을 두 곳에서 구현하고 있다. Sprint 273 이 Triggers group header 에 `+` affordance 를 추가하기 전에 single source-of-truth 로 합치는 것이 안전하다.

- **Suggested fix** — `body.tsx` 가 `buildTriggerRowsForTable` 의 `VisibleRow[]` 출력을 기존 `renderVisibleRow` dispatcher (`rows.tsx:629-663`) 를 통해 소비하도록 변경. eager-nested 렌더 경로 제거.

### 2. Concurrent expand race in `loadTriggersForGroup`

`useSchemaTreeActions.ts::loadTriggersForGroup` (lines 400–440) 에서 빠른 2회 클릭이 양쪽 모두 cache check 를 통과한 뒤 IPC가 resolve 되면 double-dispatch 발생 가능.

- **Suggested fix** — 함수 진입부 (await 이전) 에서 `loadingTriggerGroups.has(groupKey)` 로 short-circuit.
- **현재 상태** — `toggleTriggerGroup` self-gating 으로 masking 되어 production 에서 실측 발현 없음. 테스트로 pin 되어 있지 않음.

### 3. `decode_tgargs` 미escape 반환값

`decode_tgargs` 가 raw bytes 그대로 반환 (e.g. `b"O'Brien\0"` → `Some("'O'Brien'")`). Sprint 272 read path 에서는 display 가 `pg_get_triggerdef` 로 routing 되므로 acceptable.

- **Sprint 273 액션 아이템** — CREATE emitter 가 `function_arguments` 를 SQL 로 조립하기 전에 single-quote re-escape 필수. 누락 시 SQL injection / parse error 회귀.
