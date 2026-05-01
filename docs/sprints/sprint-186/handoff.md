# Sprint 186 — Handoff

Sprint: `sprint-186` (Phase 23 / Safe Mode warn 모드 + DDL typing confirm).
Date: 2026-05-01.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/stores/safeModeStore.ts` | `SafeMode` 타입 확장 (strict/warn/off), `toggle()` 3-way 순환 (`NEXT_MODE` 룩업). |
| `src/stores/safeModeStore.test.ts` | +3 케이스 (`AC-186-01a/b/c`); 기존 `[AC-185-02c]` toggle 의미 갱신 (왕복 가역성으로). |
| `src/components/workspace/SafeModeToggle.tsx` | 3-way 시각 (`MODE_META` 테이블), `ShieldAlert` icon + amber border + `aria-pressed="mixed"` (warn). |
| `src/components/workspace/SafeModeToggle.test.tsx` | +2 케이스 (`AC-186-02a/b`). 기존 `[AC-185-03c]` 의 strict→off 직행 가정 갱신 (strict→warn 첫 클릭). |
| **NEW** `src/components/workspace/ConfirmDangerousDialog.tsx` | type-to-confirm dialog (layer-1 AlertDialog primitive 사용). |
| **NEW** `src/components/workspace/ConfirmDangerousDialog.test.tsx` | 5 케이스 (`AC-186-03a~e`). |
| `src/components/datagrid/useDataGridEdit.ts` | warn 분기 inject + `pendingConfirm` state + `confirmDangerous` / `cancelDangerous` actions. try/catch 본문은 `runRdbBatch` 헬퍼로 추출. |
| `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | +3 케이스 (`AC-186-04a/b/c`). |
| `src/components/datagrid/useDataGridEdit.commit-error.test.ts` | static slice marker 갱신 (`if (!sqlPreview) return;` → `const runRdbBatch = useCallback(`). 의도 무변동. |
| `src/components/query/EditableQueryResultGrid.tsx` | warn 분기 inject + `pendingConfirm` local state + ConfirmDangerousDialog mount. `runBatch` 헬퍼 추출. |
| `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` | +3 케이스 (`AC-186-05a/b/c`). |
| `src/components/rdb/DataGrid.tsx` | ConfirmDangerousDialog 1 개 mount + `pendingConfirm` / `confirmDangerous` / `cancelDangerous` wiring. |
| `src/components/rdb/DataGrid.test.tsx` | +1 케이스 (`AC-186-06`). |
| `docs/sprints/sprint-186/contract.md` | 본 sprint contract. |
| `docs/sprints/sprint-186/findings.md` | 설계 결정 + AC→테스트 매핑 + evidence index. |
| `docs/sprints/sprint-186/handoff.md` | 본 파일. |

총 11 파일 코드 변경 + 3 파일 docs.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-186-01 | `pnpm vitest run src/stores/safeModeStore.test.ts` | **8 passed** (5 기존 + 3 신규: AC-186-01a/b/c). |
| AC-186-02 | `pnpm vitest run src/components/workspace/SafeModeToggle.test.tsx` | **5 passed** (3 기존 + 2 신규: AC-186-02a/b). |
| AC-186-03 | `pnpm vitest run src/components/workspace/ConfirmDangerousDialog.test.tsx` | **5 passed** (AC-186-03a/b/c/d/e). |
| AC-186-04 | `pnpm vitest run src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | **7 passed** (4 기존 + 3 신규: AC-186-04a/b/c). |
| AC-186-05 | `pnpm vitest run src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` | **7 passed** (4 기존 + 3 신규: AC-186-05a/b/c). |
| AC-186-06 | `pnpm vitest run src/components/rdb/DataGrid.test.tsx` | **75 passed** (74 기존 + 1 신규: AC-186-06; ConfirmDangerousDialog mount + reason 표시). |
| AC-186-07 | `pnpm vitest run` 전체 + skip-zero + cargo + invariant `git diff` | 177 files / 2595 tests passed; cargo 326 passed (0 failed, 2 ignored); clippy/fmt clean; `git diff src-tauri/` empty; `git diff src/lib/sqlSafety.ts` empty; `git diff src/types/connection.ts` empty; static skip greps 0 matches. |

## Required checks (재현)

```sh
pnpm vitest run src/stores/safeModeStore.test.ts \
  src/components/workspace/SafeModeToggle.test.tsx \
  src/components/workspace/ConfirmDangerousDialog.test.tsx \
  src/components/datagrid/useDataGridEdit.safe-mode.test.ts \
  src/components/query/EditableQueryResultGrid.safe-mode.test.tsx \
  src/components/rdb/DataGrid.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
cd src-tauri && cargo test --lib
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check
git diff --stat src-tauri/ src/types/connection.ts src/lib/sqlSafety.ts src/lib/sqlSafety.test.ts
```

기대값: 모두 zero error / empty diff.

## Phase 23 후속

- **Sprint 187**: structure surface (`ColumnsEditor` / `IndexesEditor` /
  `ConstraintsEditor`) 의 `SqlPreviewDialog` 에 환경 색띠 + warn 가드.
  본 sprint 의 `ConfirmDangerousDialog` 와 `runBatch` 패턴 재사용.
- **Sprint 188**: Mongo paradigm 의 dangerous-op 분류 (`db.collection.drop()`,
  `deleteMany({})`) + Mongo dispatch 의 strict/warn 게이트.

Phase 23 종료는 Sprint 187 + 188 완료 시점.
