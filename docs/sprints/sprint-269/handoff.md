# Sprint 269 Handoff — DbMismatch toast Retry button

## Status

Complete. Sprint 267 의 passive `toast.warning("Active DB synced to '...'")`
가 actionable Retry 버튼 토스트로 진화. Catch site closure 가 `stmt` /
`(statements, joinedSql)` 을 lexical capture, `useRef` 로 retry helper 의
latest identity 를 결합하여 useCallback dep drift 회피. `findLiveIdleTab`
헬퍼가 (a) tab 존재 + (b) `queryState.status !== "running"` 두 가드를
원자적으로 평가 → closed-tab / already-running 둘 다 no-op. Batch path
는 `mismatchToastPushed` 플래그로 N statement mismatch 가 떠도 toast 는
배치당 1회만. Sprint 267 verify-failed-silent invariant 는 `syncMismatchedActiveDb`
의 `onSynced` callback 패턴으로 보존 — verify reject 시 callback 미호출 →
toast 미surface.

## Acceptance Criteria — verification

| AC | 결과 |
|---|---|
| AC-269-01 Retry button visible | ✅ `src/components/ui/toaster.tsx:115-132` Retry button JSX (type=button, focus-visible:ring). `src/components/query/QueryTab.dbMismatch.test.tsx:243` accessible name `"Retry"` assertion |
| AC-269-02 Retry re-runs same statement (single + batch) | ✅ `src/components/query/QueryTab/useQueryExecution.ts:446-470` single closure capture + `runRdbSingleRef.current(capturedStmt)`. L547-572 batch closure capture + `runRdbBatchRef.current(capturedStatements, capturedJoinedSql)`. Tests `QueryTab.dbMismatch.test.tsx:269` single, `:314` batch |
| AC-269-03 closed-tab + already-running guards | ✅ `useQueryExecution.ts:385-399` `findLiveIdleTab` 두 가드 원자 평가. Tests `QueryTab.dbMismatch.test.tsx:372` closed-tab, `:412` already-running 독립 검증 |
| AC-269-04 Non-mismatch errors unchanged | ✅ `QueryTab.dbMismatch.test.tsx:227-232` 기존 Sprint 267 specificity case + positive assertion `queueAfter.every((t) => t.action === undefined)` |
| AC-269-05 회귀 가드 | ✅ vitest 3217/3217 (baseline 3205 + 12 monotonic), `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0, `git status src-tauri/` clean (cargo skip) |

## 주요 production 변경

| 파일 | 변경 |
|---|---|
| `src/lib/toast.ts` | `ToastAction` interface export (L21-24). `Toast.action?` (L41) + `ToastOptions.action?` (L63) optional 필드. `push()` 가 `options.action === undefined` 일 때 field 자체를 omit (null 아님) — Sprint 94 byte-equivalence 보존 |
| `src/components/ui/toaster.tsx` | `ToastItem` 내부에 Retry 버튼 JSX 추가 (L115-132, dismiss X 앞). `onClick` 이 `action.onClick()` 동기 실행 후 `onDismiss()` 호출 — stale closure 회피 + double-click no-op |
| `src/components/query/QueryTab/useQueryExecution.ts` | `findLiveIdleTab` 헬퍼 (L385-399) + `runRdbSingleRef` / `runRdbBatchRef` (L372-377). `syncMismatchedActiveDb` 의 passive toast 를 제거하고 `onSynced` callback 패턴으로 변경 (verify-failed-silent 보존). Single (L446-470) / batch (L547-572) catch site 에서 lexical capture + Retry toast push. Batch path 는 `mismatchToastPushed` flag (L511) 로 toast per batch 1회 보장 |

## 테스트

### Frontend (vitest) — 12 신규 케이스

전체 suite 3205 → 3217 (+12 monotonic).

- `src/lib/toast.test.ts:112` — `toast.warning(msg, { action })` 이 `action`
  필드를 persisted `Toast` 에 그대로 복사.
- `src/lib/toast.test.ts:125` — `action` 없는 기존 call site 의 결과
  `Toast.action === undefined` (null 이 아님) — backward-compat pin.
- `src/components/ui/toaster.test.tsx:212` — `action` 있는 toast 가
  `type="button"` + accessible name = `action.label` 인 버튼 렌더.
- `src/components/ui/toaster.test.tsx:228` — Retry 버튼 클릭이
  `action.onClick` 을 정확히 1회 호출.
- `src/components/ui/toaster.test.tsx:241` — Retry 버튼 클릭이 toast 를
  queue 에서 제거 (dismiss-on-click).
- `src/components/ui/toaster.test.tsx:257` — `action` 없는 toast 는 버튼
  개수가 정확히 1 (dismiss X 만).
- `src/components/query/QueryTab.dbMismatch.test.tsx:227` — Sprint 267
  specificity case 가 `action === undefined` positive assertion 으로 확장.
- `src/components/query/QueryTab.dbMismatch.test.tsx:243` — AC-269-01
  mismatch toast 가 accessible name `"Retry"` 의 버튼 노출.
- `src/components/query/QueryTab.dbMismatch.test.tsx:269` — AC-269-02 single
  path Retry click → `mockExecuteQuery` 두 번째 호출 동일 stmt +
  now-synced `expectedDatabase`.
- `src/components/query/QueryTab.dbMismatch.test.tsx:314` — AC-269-02 batch
  path Retry click → 배치 statements 전부 재실행.
- `src/components/query/QueryTab.dbMismatch.test.tsx:372` — AC-269-03
  closed-tab path: tab 제거 후 Retry click → 추가 `executeQuery` 호출
  없음.
- `src/components/query/QueryTab.dbMismatch.test.tsx:412` — AC-269-03
  already-running path: `queryState.status = "running"` 설정 후 Retry
  click → no-op (double-fire 가드).
- `src/components/query/QueryTab.dbMismatch.test.tsx:477` — Sprint 267
  verify-failed-silent invariant pin: `verifyActiveDb` reject 시 toast 가
  queue 에 push 되지 않음.

Backend `cargo test` 변경 없음 (in-scope frontend 한정, `src-tauri/` 무결).

## Out of Scope

contract.md §Out of Scope 와 동일:

1. **Sprint 270 (cold-boot skeleton placeholders)** — perceived performance
   별 sprint, `Skeleton` primitive 미도입.
2. **Sprint 271 (`expected_database` 가드 propagation)** — 다른 RDB
   command (introspection / DDL) 별 sprint, backend 무변경.

## Lessons

- **Toast push 위치 이동 — closure 가 lexical access 를 가져야 함** —
  Sprint 267 은 passive toast 를 `syncMismatchedActiveDb` 헬퍼 안에서
  push 했지만, 269 의 Retry 는 `stmt` / `(statements, joinedSql)` 을
  capture 해야 재실행 가능. 그래서 toast push 를 catch site (caller) 로
  옮기고 헬퍼는 `onSynced` callback 만 받게 변경. "어디서 push 하느냐"
  가 closure 의 capture set 을 정의 — 헬퍼 추출이 항상 옳은 게 아님.
  verify-failed-silent invariant 는 callback 호출 조건 (verify 성공 +
  actual 비어있지 않음) 으로 보존.
- **Ref-backed retry helpers — useCallback dep drift 회피** —
  `runRdbSingleNow` / `runRdbBatchNow` 가 `useCallback` 으로 매 render
  identity 가 바뀌면 catch 시점에 capture 된 closure 의 `fn` 이 stale
  될 위험. `useRef` 로 wrap 하여 click 시점에 `ref.current` 가 항상
  latest 를 가리키게. ref 동기화는 every-render 의 simple effect (L491,
  L622) — `useCallback` deps 와 결합되어도 ref 가 최종 진리.
- **One toast per batch — UX 노이즈 회피** — 배치의 N statement 가 전부
  mismatch 면 토스트 N개가 spam 됨. `mismatchToastPushed` 플래그 (L511)
  로 첫 mismatch 에서만 push, 이후는 idempotent verify+sync 만 돌리고
  suppress. Convergence guarantee 는 `connectionStore` 가 보장하므로
  toast 만 dedup. "user-facing notification 의 cardinality 가 backend
  event 의 cardinality 와 동일할 필요 없다" 는 일반 원칙.
