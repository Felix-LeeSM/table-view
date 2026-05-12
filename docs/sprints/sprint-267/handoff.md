# Sprint 267 Handoff — DbMismatch 자동 sync + switch_active_db 직렬화 invariant

## Status

Complete.

- **5. DbMismatch UX**: Sprint 266 의 `AppError::DbMismatch` 가 backend
  에서 차단된 후 frontend 가 즉시 `verifyActiveDb` 로 backend 의 actual db
  를 받아 `connectionStore.activeStatuses` + `schemaStore` 를 sync. 다음
  user click 이 올바른 expectedDatabase 로 자동 재시도되도록 함.
- **6. `switch_active_db` 직렬화**: audit 결과 resolved-by-design.
  `state.active_connections.lock()` 가 dispatch 전체를 감싸 동일 connection
  의 두 swap 호출은 lock 순서대로 자동 직렬화. per-conn mutex 도입은
  over-engineering — regression 가드 테스트로 invariant 동결만.

## Acceptance Criteria — verification

| AC | 결과 |
|---|---|
| AC-267-01 `parseDbMismatch` 헬퍼 | ✅ `src/lib/api/dbMismatch.ts` — regex 기반 구조 식별 + 3 unit case (정상 / non-mismatch / malformed) |
| AC-267-02 useQueryExecution 자동 sync | ✅ `runRdbSingleNow` + `runRdbBatchNow` 의 catch 에서 parseDbMismatch + `syncMismatchedActiveDb` 호출. fire-and-forget — verify 실패 시 silent (best-effort) |
| AC-267-03 switch_active_db 직렬화 invariant | ✅ Audit 후 resolved-by-design. meta.rs:88 의 `active_connections.lock()` 가 이미 직렬화. `switch_active_db_concurrent_calls_are_serialized_last_writer_wins` 회귀 가드 추가 |
| AC-267-04 회귀 가드 | ✅ vitest 3201 passed (+6 vs Sprint 266), tsc clean, lint clean, cargo clippy clean, cargo test 674 passed (+1) |

## 주요 production 변경

| 파일 | 변경 |
|---|---|
| `src/lib/api/dbMismatch.ts` | 신규 — `parseDbMismatch(message)` 가 Sprint 266 backend format `"Database mismatch: expected 'X', backend pool has 'Y'"` 를 `{ expected, actual }` 로 분해. regex 한 줄, 단일 책임 |
| `src/components/query/QueryTab/useQueryExecution.ts` | `syncMismatchedActiveDb` 헬퍼 추가 — verifyActiveDb round-trip + setActiveDb + clearForConnection + toast. 단일 / 배치 statement catch 둘 다 mismatch 감지 시 호출. fire-and-forget |

## 테스트

### Frontend (vitest) — 6 신규 케이스

- `src/lib/api/dbMismatch.test.ts` (신규): 3 unit case — Sprint 266 format
  추출 / non-mismatch null / malformed null.
- `src/components/query/QueryTab.dbMismatch.test.tsx` (신규): 3 integration
  case
  - single-statement mismatch → `verifyActiveDb` 호출 + `activeStatuses.conn1.activeDb` 가 backend actual 로 sync
  - multi-statement batch 의 statement-level mismatch → 동일 sync
  - non-mismatch error → `verifyActiveDb` 호출 안 됨 (mismatch 식별의
    specificity 회귀 가드)

### Backend (cargo test) — 1 신규 케이스

- `commands::meta::tests::switch_active_db_concurrent_calls_are_serialized_last_writer_wins`
  — `active_connections.lock()` 이 dispatch 전체를 감싸 동일 connection 의
  두 swap 호출이 순서대로 처리되는 invariant 동결. 향후 locking 모델이
  fine-grained 화 되어도 같은 의미가 유지되어야 함을 회귀 가드로 표현.

## Out of Scope (Sprint 268+ 후보)

spec.md §Out of Scope 와 동일:

1. **Retry button** — toast 가 retry 버튼 노출하는 UX. 본 sprint 의 자동
   sync 가 user 의 next-click 으로 retry 를 자연스럽게 함. Retry 버튼은
   별 sprint.
2. **다른 RDB command 에 expected_database 가드 추가** — Sprint 266 OoS #1.
3. **`switch_active_db` cancel/timeout** — long-running swap 의 cancel 처리.

## Lessons

- **Audit-first 가 implementation 보다 가치 큰 sprint 였음** — 6번
  (mutex) 은 audit 결과 이미 직렬화. 5번도 backend 에서 차단되는 mismatch
  를 frontend 가 generic error 로만 surface 한다는 갭만 명확. 두 갭 모두
  "wide migration 없이 minimal-correct" 로 좁힘.
- **Toast 의 fire-and-forget pattern** — `queryHelpers.applyDbMutationHint`
  의 try/catch 패턴 그대로 재사용. "verify 실패 ≠ query 실패" 의 invariant
  로 verify 실패가 두 번째 user-facing 실패로 escalate 되지 않도록 함.
- **Test 격리 — 새 test 는 별 파일로** — `QueryTab.execution.test.tsx` 와
  같은 module 에 두 가지 toast.warning + setActiveDb 호출하는 신규 case
  를 추가하니 직전 uglify 테스트가 race 로 fail. 신규 sync flow 의 async
  chain 격리 위해 `QueryTab.dbMismatch.test.tsx` 로 split. RTL +
  zustand store 의 글로벌 state 가 시간차 cleanup 으로 pollute 되는 경우
  새 파일 + 자체 vi.mock 으로 분리하는 게 simpler 한 해결책.
- **Coarse lock 도 정답일 수 있음** — `active_connections.lock()` 가 모든
  connection 의 모든 command 를 직렬화 — over-locking 처럼 보이지만
  throughput bottleneck 증거가 없고 race-correctness 측면에선 가장 단순.
  성급한 fine-grained mutex 도입은 향후 locking 패턴이 분기되어 audit
  surface 가 커지는 부작용. "현재 동작이 옳다" 를 invariant 로 동결하는
  test 가 최소 침습.
