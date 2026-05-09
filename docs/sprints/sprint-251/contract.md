# Sprint Contract: sprint-251

## Summary

- Goal: `useDataGridEdit` 의 4 슬라이스 (`pendingEdits`, `pendingNewRows`,
  `pendingDeletedRowKeys`, `undoStack`) 를 `(connectionId, schema, table)` 키
  단위 zustand store 로 lift. 탭 전환으로 인한 컴포넌트 unmount/remount 가
  더 이상 사용자의 작업물을 잃지 않게 한다. tab close / connection drop 시
  entry purge. Cross-window 동기화 / localStorage persistence 는 out-of-scope.
- Audience: Generator + Evaluator agents (harness, /tdd 스타일)
- Owner: Sprint 251
- Verification Profile: `command`

## In Scope

### 신규 store

- `src/stores/dataGridEditStore.ts` (또는 동등 위치 — Generator 결정. naming
  convention `*Store.ts`):
  - state shape:
    ```ts
    interface PendingEntry {
      pendingEdits: ReadonlyMap<string, string | null>;
      pendingNewRows: ReadonlyArray<unknown[]>;
      pendingDeletedRowKeys: ReadonlySet<string>;
      undoStack: ReadonlyArray<EditSnapshot>;
    }
    interface DataGridEditStore {
      entries: ReadonlyMap<string, PendingEntry>; // key = `${cid}::${schema}::${table}`
      getEntry: (key: string) => PendingEntry;    // empty defaults if missing
      setSlice: <K extends keyof PendingEntry>(key: string, slice: K, value: PendingEntry[K]) => void;
      clearEntry: (key: string) => void;
      purgeForConnection: (connectionId: string) => void;
      purgeKey: (key: string) => void;
    }
    ```
  - persist 사용 안 함 (in-memory only).
  - empty PendingEntry 상수 export — `useDataGridEdit` 가 missing entry 일
    때 fallback.

### `useDataGridEdit` 재배선

- `src/components/datagrid/useDataGridEdit.ts`:
  - 4 슬라이스의 source-of-truth 가 `useState` → `useDataGridEditStore` selector + setter 로 이동.
  - `clearAllPending` 가 store 의 `clearEntry(key)` 호출.
  - hook 내부 `pushSnapshot` / `undo` 로직은 store-backed 환경에서도 동일
    동작 — store action 을 통해 작용.
  - **Returned shape 변경 0** — 외부 (DataGridTable, DataGridToolbar, DataGrid)
    가 보는 인터페이스는 그대로.
  - hook prop 으로 이미 `connectionId`, `schema`, `table` 받고 있음
    (확인 후 그대로 활용) — 키 합성: `${connectionId}::${schema}::${table}`.

### tabStore wire-up

- `src/stores/tabStore.ts`:
  - `removeTab(id)` 안에서 닫히는 tab 의 (cid, schema, table) 키를 계산해
    `dataGridEditStore.purgeKey(key)` 호출. 단, **같은 키의 다른 탭이 살아
    있으면 purge 하지 않음** (e.g. 동일 table 의 preview + persistent 탭).
  - `clearTabsForConnection(connectionId)` 안에서
    `dataGridEditStore.purgeForConnection(connectionId)` 호출.
  - import: store 간 직접 참조 또는 lifecycle subscribe 패턴 (Generator 결정).

### 신규 store 테스트

- `src/stores/dataGridEditStore.test.ts`:
  - `[AC-251-S1]` 두 다른 키에 set → getEntry 가 서로 격리.
  - `[AC-251-S2]` setSlice → 다른 슬라이스 보존 + 해당 슬라이스만 업데이트.
  - `[AC-251-S3]` clearEntry → 4 슬라이스 모두 비움 (또는 entry 자체 삭제).
  - `[AC-251-S4]` purgeKey → 해당 키 entry 제거.
  - `[AC-251-S5]` purgeForConnection → 같은 connectionId prefix 의 모든 키 일괄 제거.

### `useDataGridEdit` 재배선 테스트

- `src/components/datagrid/useDataGridEdit.persist.test.ts` 신규:
  - `[AC-251-H1]` hook unmount → 동일 키로 re-mount → 4 슬라이스 보존
    (cell edit 1개 + new row 1개 + deleted row 1개 + undoStack 1 entry).
  - `[AC-251-H2]` 다른 키로 mount → empty state.
  - `[AC-251-H3]` 1번 mount 의 hook 이 set → 2번 mount (동일 키) 의 hook 이
    동일 값 read.
  - `[AC-251-H4]` clearAllPending → store entry 도 비워짐 (다음 mount empty).
  - `[AC-251-H5]` Sprint 249 / 250 의 기존 회귀 (canUndo, undo, onBlur, Esc)
    가 store-backed 환경에서도 동일하게 동작.

### tabStore wire-up 테스트

- `src/stores/tabStore.test.ts` 또는 신규 `tabStore.persist-purge.test.ts`:
  - `[AC-251-T1]` `removeTab(id)` → 같은 키의 다른 탭이 없으면 store 의 해당
    key entry purge.
  - `[AC-251-T2]` `removeTab(id)` → 같은 키의 다른 탭이 살아있으면 store
    entry 보존 (no purge).
  - `[AC-251-T3]` `clearTabsForConnection(cid)` → 해당 connection 의 모든
    store entry 일괄 purge.

## Out of Scope

- Cross-window pending state 동기화 (BroadcastChannel 등).
- localStorage persistence — store 는 in-memory only.
- DDL editor / raw query grid (`useRawQueryGridEdit`) 의 store-lift — 별도
  pending state 패턴, 후속 sprint 후보.
- Mongo grid (read-only) — pending state 자체가 없음.
- ConfirmDestructiveDialog / DryRunPreview / Sprint 247 의 dry-run IPC.
- `decideSafeModeAction` / SafeModeStore 변경.
- Sprint 252 의 PreviewDialog polish.
- Per-tab vs all-tabs commit 결정 — 본 sprint 는 *pending* state 만 보존,
  commit 의미 변경 없음.
- Tab close 확인 dialog ("you have pending changes — discard?") 추가 — 향후
  결정.

## Invariants

- `useDataGridEdit` returned 30+ 필드 보존 (`saveCurrentEdit`, `handleDiscard`,
  `cancelEdit`, `pendingEdits`, `pendingNewRows`, `pendingDeletedRowKeys`,
  `undoStack`, `canUndo`, `undo`, `handleStartEdit`, `handleAddRow`,
  `handleDeleteRow`, `handleDuplicateRow`, etc.).
- AC-250-01..06 (onBlur + Esc) 회귀 없음.
- AC-249-U1..U9 (undo) 회귀 없음.
- AC-248-* (dry-run) / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-*
  보존.
- `tabStore.dirtyTabIds` publish 흐름 (`setTabDirty`) 보존.
- `useDataGridEdit` 의 `setTabDirty` 호출 (commit hint) 변경 0 — store-backed
  환경에서도 동일 발동.
- IPC / safeModeStore / persistence 변경 0.
- Mongo grid read-only invariant 보존.

## Acceptance Criteria

(spec 의 AC-251-01 ~ AC-251-07 + 상세 store/hook/tabStore 테스트로 매핑)

### Store

- `AC-251-S1` 두 다른 키에 set → getEntry 격리.
- `AC-251-S2` setSlice → 다른 슬라이스 보존.
- `AC-251-S3` clearEntry → 4 슬라이스 비움.
- `AC-251-S4` purgeKey → entry 삭제.
- `AC-251-S5` purgeForConnection → connectionId prefix 일괄 삭제.

### Hook

- `AC-251-H1` unmount → 동일 키 re-mount → 4 슬라이스 + canUndo 보존.
- `AC-251-H2` 다른 키 mount → empty.
- `AC-251-H3` 두 hook 인스턴스 (동일 키) → 동일 값 share.
- `AC-251-H4` clearAllPending → store entry 비움.
- `AC-251-H5` Sprint 249 / 250 회귀 없음 (각각 9 / 9 testcase 통과).

### tabStore wire

- `AC-251-T1` removeTab + 같은 키 다른 탭 없음 → store entry purge.
- `AC-251-T2` removeTab + 같은 키 다른 탭 살아있음 → entry 보존.
- `AC-251-T3` clearTabsForConnection → 해당 connection 모든 entry purge.

### 회귀 (spec 의 AC-251-06 매핑)

- `AC-251-R1` `useDataGridEdit.undo.test.ts` 9 케이스 통과.
- `AC-251-R2` `DataGrid.undo.test.tsx` 5 케이스 통과.
- `AC-251-R3` `useDataGridEdit.onblur.test.ts` (Sprint 250) 5 케이스 통과.
- `AC-251-R4` `DataGrid.esc.test.tsx` (Sprint 250) 4 케이스 통과.

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과 (예상 ≥ 3000 — Sprint 250 baseline 2989 + 신규 ~13
  케이스).
- `it.skip` / `it.todo` / `xit` 도입 금지.
- /tdd 스타일: Generator 는 신규 store + hook persist + tabStore wire 테스트
  먼저 작성, fail 확인 후 구현. handoff 한 줄 명시.
- store entry key 합성은 단일 helper 함수 (`makeKey(cid, schema, table)`) 에
  격리해 typo 방지.
- store action 은 immutable (Map / Set / Array 새 인스턴스 반환) — Sprint
  249 의 deep copy 정책과 동일.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-251-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 (Rust 미변경).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀.
6. `rg "dataGridEditStore|DataGridEditStore" src/` — 신규 store 정의 + 사용 확인 ≥ 3.
7. `rg "purgeKey|purgeForConnection" src/stores/tabStore.ts` — wire-up 확인 ≥ 1.

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌.
  - `[AC-251-*]` ↔ 테스트 파일:라인 매핑 표.
  - store 본문 인용 (entry key 합성 helper, immutable update).
  - `useDataGridEdit` 재배선 본문 인용 (useState 제거 + selector/setter 사용).
  - tabStore wire-up 본문 인용 (removeTab + clearTabsForConnection 안의 purge 호출).
  - /tdd 흐름 증거.
  - 가정 / 잔여 위험 (Hot reload 시 store identity, 동일 키 두 탭의 share
    의도, undoStack 50 한도 store 환경에서 보존, etc.).
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - `useDataGridEdit` 의 returned shape 가 그대로 인지 git diff 로 확인.
  - 같은 키 두 탭 (preview + persistent) 시나리오의 share 동작 verbatim 검증.
  - tabStore wire-up 의 `purgeKey` / `purgeForConnection` 호출 verbatim 확인.

## Test Requirements

### Unit Tests (필수, /tdd)

- `dataGridEditStore.test.ts` — 5 케이스 (`AC-251-S1..S5`).
- `useDataGridEdit.persist.test.ts` — 5 케이스 (`AC-251-H1..H5`).
- tabStore persist-purge — 3 케이스 (`AC-251-T1..T3`).
- 기존 회귀 가드 — `useDataGridEdit.undo.test.ts`, `DataGrid.undo.test.tsx`,
  `useDataGridEdit.onblur.test.ts`, `DataGrid.esc.test.tsx` 모두 변경 없이
  통과.

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — 탭 A 에서 cell edit → 탭 B 전환 → 탭 A 복귀 → 편집 보존.
- [x] 에러/예외 — store entry 가 missing 일 때 hook 이 empty default 로
  fallback (panic 없음).
- [x] 경계 조건 — 같은 키 두 탭 동시 mount, removeTab + 같은 키 다른 탭 살아
  있음 → purge 안 함, connection drop → bulk purge.
- [x] 회귀 없음 — Sprint 249 / 250 / 248 / 247 / 246 / 245 모두 통과.

## Test Script / Repro Script

```bash
git diff --stat HEAD

pnpm tsc --noEmit
pnpm lint

# 변경 영역 타겟 테스트
pnpm vitest run \
  src/stores/dataGridEditStore.test.ts \
  src/stores/tabStore.test.ts \
  src/components/datagrid/useDataGridEdit.persist.test.ts \
  src/components/datagrid/useDataGridEdit.undo.test.ts \
  src/components/datagrid/useDataGridEdit.onblur.test.ts \
  src/components/rdb/DataGrid.undo.test.tsx \
  src/components/rdb/DataGrid.esc.test.tsx \
  src/components/rdb/DataGrid.editing.test.tsx

# 전체 회귀
pnpm vitest run

# Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# Wire-up grep
rg "dataGridEditStore|DataGridEditStore" src/
rg "purgeKey|purgeForConnection" src/stores/tabStore.ts
```

## Ownership

- Generator: harness Generator agent (general-purpose), /tdd 엄수.
- Write scope: 위 In Scope 의 파일들만. DDL editor / raw query grid /
  Sprint 252 PreviewDialog polish / decideSafeModeAction / IPC 변경 금지.
- Merge order: 단일 commit 권장 — store + hook 재배선 + tabStore wire 는
  atomic. lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- /tdd 흐름 증거 (테스트 먼저).
- Sprint 250 / 249 / 248 / ADR 0022 invariants 보존.
- Cross-window 동기화 / localStorage persistence 는 명시적으로 out-of-scope
  로 handoff 에 기록.
