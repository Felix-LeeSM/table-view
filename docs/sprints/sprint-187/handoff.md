# Sprint 187 — Handoff

Sprint: `sprint-187` (Phase 23 / structure surface 색띠 + warn 가드).
Date: 2026-05-01.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/lib/sqlSafety.ts` | `StatementKind` 에 `"ddl-alter-drop"` 추가; `DROP INDEX/VIEW` 를 ddl-drop danger 로 분류; `ALTER TABLE … DROP COLUMN/CONSTRAINT` 를 ddl-alter-drop danger 로 분류. |
| `src/lib/sqlSafety.test.ts` | +5 케이스 (`AC-187-01a~e`). |
| `src/components/ui/dialog/PreviewDialog.tsx` | `headerStripe?: ReactNode` slot 추가 (default null, `<DialogHeader>` 위 위치). |
| `src/components/structure/SqlPreviewDialog.tsx` | `environment?: string \| null` prop 추가 + ENVIRONMENT_META 가드 후 색띠 div 를 `headerStripe` 로 forward. |
| `src/components/structure/SqlPreviewDialog.test.tsx` | +1 케이스 (`AC-187-03a` — production stripe 렌더). |
| `src/components/structure/ColumnsEditor.tsx` | `useConnectionStore` + `useSafeModeStore` selector; `runAlter` helper 추출; `handleExecute` 에 strict / warn 가드; `pendingConfirm` state + `confirmDangerous` / `cancelDangerous`; `<ConfirmDangerousDialog>` mount; `SqlPreviewDialog` 에 `environment` 전달. |
| `src/components/structure/ColumnsEditor.test.tsx` | +5 케이스 (`AC-187-04a~e`). |
| `src/components/structure/IndexesEditor.tsx` | 동일 패턴 — `runPendingExecute` 추출, gate 위치는 `handlePreviewConfirm` 안. |
| **NEW** `src/components/structure/IndexesEditor.test.tsx` | 5 케이스 (`AC-187-05a~e`). |
| `src/components/structure/ConstraintsEditor.tsx` | IndexesEditor 와 동일 구조. |
| **NEW** `src/components/structure/ConstraintsEditor.test.tsx` | 5 케이스 (`AC-187-06a~e`). |
| `docs/sprints/sprint-187/contract.md` | 본 sprint contract. |
| `docs/sprints/sprint-187/findings.md` | 설계 결정 + AC→테스트 매핑 + evidence index. |
| `docs/sprints/sprint-187/handoff.md` | 본 파일. |

총 11 파일 코드 변경 + 3 파일 docs.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-187-01 | `pnpm vitest run src/lib/sqlSafety.test.ts` | **19 passed** (14 기존 + 5 신규: AC-187-01a/b/c/d/e). |
| AC-187-02 | `git diff src/components/ui/dialog/PreviewDialog.tsx` 의 `headerStripe` prop 라인 추가 | downstream `[AC-187-03a]` 가 implicitly cover (stripe 가 화면에 나타남). |
| AC-187-03 | `pnpm vitest run src/components/structure/SqlPreviewDialog.test.tsx` | **6 passed** (5 기존 + 1 신규: AC-187-03a; production stripe 렌더 + aria-hidden). |
| AC-187-04 | `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx` | **9 passed** (4 기존 + 5 신규: AC-187-04a/b/c/d/e). |
| AC-187-05 | `pnpm vitest run src/components/structure/IndexesEditor.test.tsx` | **5 passed** (NEW; AC-187-05a~e). |
| AC-187-06 | `pnpm vitest run src/components/structure/ConstraintsEditor.test.tsx` | **5 passed** (NEW; AC-187-06a~e). |
| AC-187-07 | `pnpm vitest run` 전체 + tsc + lint + cargo + invariant `git diff` | 179 files / 2616 tests passed; cargo 326 passed (0 failed, 2 ignored); clippy/fmt clean; `git diff src-tauri/` empty; `git diff src/types/connection.ts` empty; `git diff src/components/workspace/ConfirmDangerousDialog.tsx src/components/workspace/SafeModeToggle.tsx src/stores/safeModeStore.ts` empty; static skip greps 0 matches. |

## Required checks (재현)

```sh
pnpm vitest run src/lib/sqlSafety.test.ts \
  src/components/structure/SqlPreviewDialog.test.tsx \
  src/components/structure/ColumnsEditor.test.tsx \
  src/components/structure/IndexesEditor.test.tsx \
  src/components/structure/ConstraintsEditor.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
cd src-tauri && cargo test --lib
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check
git diff --stat src-tauri/ \
  src/types/connection.ts \
  src/components/workspace/ConfirmDangerousDialog.tsx \
  src/components/workspace/SafeModeToggle.tsx \
  src/stores/safeModeStore.ts
```

기대값: 모두 zero error / empty diff.

## Phase 23 후속

- **Sprint 188**: Mongo paradigm dangerous-op 분류 (`db.collection.drop()`,
  `deleteMany({})`) + Mongo dispatch 의 strict / warn 게이트. Sprint 187
  의 inline gate 패턴을 helper hook (`useSafeModeGate`) 으로 추출하여
  4 번째 call site (Mongo) 합류 시점에 합리적 — DRY 의 inflection point.

Phase 23 종료는 Sprint 188 완료 시점.
