# Sprint 267 Spec — DbMismatch UX 동기화 + switch_active_db 직렬화

## Feature Description

Sprint 266 가 `AppError::DbMismatch` opt-in 가드를 도입했으나 frontend 는
generic error message 로만 surface — user 가 active DB 가 어긋났음을
알아도 활용 가능한 후속 조치 없음 (refresh/retry).

본 sprint:

- **5. DbMismatch UX**: catch 에서 mismatch 구조 식별 → 즉시 `verifyActiveDb`
  round-trip → frontend `activeStatuses[connId].activeDb` 를 backend actual
  로 sync. user 가 같은 쿼리를 다시 누르면 (이미 동기화된 expectedDb 로) 정상
  실행. toast 메시지로 변화 알림.
- **6. `switch_active_db` 직렬화**: 동시 호출 시 race 방지. Backend
  mutex 로 한 connection 당 swap 직렬화.

## 배경 — 현재 한계

### DbMismatch surface (5)

- `useQueryExecution.ts:356-368` catch 가 `err.message` 만 보고 `failQuery`
  호출. DbMismatch 구조 정보 무시.
- 사용자는 `"Database mismatch: expected 'X', got 'Y'"` 텍스트를 result
  pane 에 봄. 활용 가능한 action 없음.
- `dispatchDbMutationHint` (queryHelpers.ts:116) 가 verifyActiveDb 호출하나
  SQL 에 `\c db` / `USE db` 패턴이 있을 때만. SELECT mismatch 는 hit 안 됨.

### switch_active_db 직렬화 (6)

- `commands/meta.rs` 의 `switch_active_db` 가 active_connections lock 안에서
  swap 수행하나, frontend DbSwitcher 가 동시 두 swap 발사하면 두 가지가 lock
  순서대로 처리됨 — 마지막 win. 의도된 동작이지만 중간 상태에서 다른
  command 가 끼어들면 partial swap 가능성.
- per-connection serialization 보장 필요.

## ADR 0027 와의 관계

새 ADR 추가 안 함. ADR 0027 `(connId, db)` 라우팅의 user-facing surface +
race-safety 마무리.

## Sprint Breakdown

3 slice:

1. **Slice A**: `parseDbMismatch` 헬퍼 + `useQueryExecution` 가 catch 에서
   mismatch 구조 식별 → `verifyActiveDb` + `setActiveDb` 동기화 + toast.
   TDD 트레이서.
2. **Slice B**: `switch_active_db` 직렬화 invariant audit + regression
   guard 테스트만 추가 (per-conn mutex 불요 — audit 결과 active_connections
   lock 이 이미 직렬화).
3. **Slice C**: 회귀 가드 + handoff.

## Acceptance Criteria

### AC-267-01 — `parseDbMismatch` 헬퍼

`src/lib/api/dbMismatch.ts`:

```ts
export interface DbMismatchInfo {
  expected: string;
  actual: string;
}

export function parseDbMismatch(message: string): DbMismatchInfo | null;
```

- Match `"Database mismatch: expected 'X', backend pool has 'Y'"` (Sprint 266
  backend format).
- 다른 메시지는 `null`.
- Unit-tested with both shape variants (정상 / non-mismatch).

### AC-267-02 — `useQueryExecution` 자동 동기화

`runRdbSingleNow` + `runRdbBatchNow` 의 catch 블록에서:

1. `parseDbMismatch(err.message)` 호출.
2. Match 시: `verifyActiveDb(tab.connectionId)` round-trip.
3. `useConnectionStore.setActiveDb(connId, actual)` — frontend store sync.
4. `useSchemaStore.clearForConnection(connId)` — stale schema cache 비움.
5. `toast.warning("Active DB synced to 'X'. Re-run the query if needed.")`.
6. `failQuery` 는 여전히 호출 (mismatch 는 query 실패 — auto-retry 안 함).

### AC-267-03 — `switch_active_db` 직렬화 invariant 동결

**Audit 결과 resolved-by-design.** 현재 `switch_active_db` (meta.rs:83-103)
가 `state.active_connections.lock()` 으로 dispatch 전체를 감싸므로 동일
connection 의 두 swap 호출은 lock 순서대로 직렬화 — race 없음. per-conn
mutex 도입은 over-engineering (현재의 coarse lock 이 throughput bottleneck
이라는 증거 없음).

대신 **regression 가드 테스트**로 invariant 동결: 동시 두 swap → 둘 다
순서대로 처리 + last-writer-wins. 향후 locking 모델이 fine-grained 화 되어도
동일 의미 유지 필요.

### AC-267-04 — 회귀 가드

- `pnpm vitest run --no-file-parallelism` 3195 baseline 유지 (+ Sprint 267
  신규 케이스 ≥ 3).
- `pnpm tsc --noEmit`, `pnpm lint` 통과.
- `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`
  통과 (+ Sprint 267 concurrent test).

## Out of Scope

- **Retry button** — toast 가 retry 버튼 노출하는 UX. 본 sprint 의 자동
  sync 가 사용자의 next-click 으로 retry 를 자연스럽게 함. Retry 버튼은
  별 sprint.
- **다른 RDB command 에 expected_database 가드 추가** — Sprint 266 OoS #1.
- **`switch_active_db` cancel/timeout** — long-running swap (network 지연)
  의 cancel 처리. 별 sprint.
