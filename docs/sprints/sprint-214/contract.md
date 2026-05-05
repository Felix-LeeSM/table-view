# Sprint Contract: sprint-214

## Summary

- Goal: `src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 3 editor 의 공통 commit lifecycle (preview SQL state, safe mode gate 루프, warn-tier confirm, history recording, refresh) 을 `useDdlPreviewExecution` hook 으로 추출. 각 editor 는 hook 호출 + 도메인 closure 2개 (preview / commit) 만 전달. 행동 변경 0; 외부 import path + 3 default export + props interface + 3 regression test + SqlPreviewDialog test 모두 동결.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- `useDdlPreviewExecution` hook 신규 작성 (preview SQL state + safeModeGate 루프 + pendingConfirm + warn-tier confirm/cancel + history recording + onRefresh + cleanup).
- 3 editor 의 commit lifecycle 보일러플레이트 제거 + hook 호출 + domain closure 전달로 대체.
- Hook 위치: `src/components/structure/useDdlPreviewExecution.ts`.

## Out of Scope

- 행동 변경, 새 feature 추가.
- `ColumnsEditor.test.tsx` / `IndexesEditor.test.tsx` / `ConstraintsEditor.test.tsx` / `SqlPreviewDialog.test.tsx` 변경 (4 파일 모두 변경 0).
- `StructurePanel.tsx` 변경 (외부 importer).
- `tauri.alterTable` / `tauri.createIndex` / `tauri.dropIndex` / `tauri.addConstraint` / `tauri.dropConstraint` payload 변경.
- `SqlPreviewDialog` / `ConfirmDangerousDialog` API 변경.
- `useSafeModeGate` / `useQueryHistoryStore` API 변경.
- `analyzeStatement` / `safeModeGate.decide` 호출부 변경.
- "Safe Mode (warn): confirmation cancelled — no changes committed" 메시지 변경.
- history `source: "ddl-structure"` / `paradigm: "rdb"` / `queryMode: "sql"` tagging 변경.
- 새 unit test 작성 의무 (선택, generator 재량).

## Invariants

- 외부 import path: `@components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}` 모두 default export 동결. `StructurePanel.tsx:6-8` 의 default import 라인 변경 0.
- 3 editor props interface (`ColumnsEditorProps` / `IndexesEditorProps` / `ConstraintsEditorProps`) 시그니처 변경 0.
- Hook 은 `src/components/structure/` 안에서만 사용 (외부 노출 0).
- sprint-179 paradigm copy + sprint-187 Safe Mode 5단계 (strict block / warn confirm / cancel / non-prod skip / 메시지) + sprint-196 history record + sprint-109 SqlSyntax 모두 사전 동일.
- ConfirmDangerousDialog `data-slot="alert-dialog-content"` + reason + sqlPreview prop 시그니처 보존.
- SqlPreviewDialog environment prop (production stripe) 보존.
- 새 `eslint-disable*` 0. 새 silent `catch{}` 0 (기존 5 catch 본문 의미 유지).
- Tauri command 호출 hook 안 절대 0 (`grep -n "tauri\\." src/components/structure/useDdlPreviewExecution.ts` 매치 0).

## Acceptance Criteria

- `AC-01`: hook 파일 존재 + 80~250 lines + 1+ named export. `wc -l src/components/structure/useDdlPreviewExecution.ts` ≥ 80, ≤ 250.
- `AC-02`: 3 editor 가 hook 사용 — `grep -n "useDdlPreviewExecution"` 합산 ≥ 6 매치 (3 import + 3 호출). 동시에 `previewSql` / `previewLoading` / `previewError` / `pendingConfirm` 4 state 의 `useState` 선언 3 editor 모두 0건.
- `AC-03`: 3 editor 모두 사전 lines 미만 (`<775` / `<579` / `<649`). 4 파일 합산 (3 editor 사후 + hook) ≤ 사전 합산 (2003) + 150 buffer = 2153.
- `AC-04`: 4 regression test (3 editor + SqlPreviewDialog) 변경 0 — `git diff --stat` 모두 0 changes. `pnpm vitest run` 4 파일 exit 0 (24 cases 통과).
- `AC-05`: 프로젝트 회귀 0 — `pnpm vitest run` (post-Sprint-213 baseline 189 files / 2720 tests, ±1 file 허용) / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 새 `eslint-disable*` 0. 새 silent `catch{}` 0. `StructurePanel.tsx` diff 0.

## Design Bar / Quality Bar

- 추출 + 적용. 새 비즈니스 로직 추가 금지.
- hook 입력 ≤ 4개 (P7 risk note 의 "최소 공통 lifecycle" 답습 — 너무 generic 방어).
- hook 안의 history payload `source: "ddl-structure"` / `paradigm: "rdb"` / `queryMode: "sql"` hardcoded 권고 (3 editor 모두 동일 — props 화 불필요).
- domain Tauri call 은 hook 안 절대 0 — caller closure 안.
- 사전 5 catch 본문 의미 (setPreviewError + addHistoryEntry error) 보존.
- 모든 sprint commit 의 git diff 가 "lifecycle 보일러플레이트 → hook 호출 + closure" 로 읽혀야 함.

## Verification Plan

### Required Checks

1. `wc -l src/components/structure/useDdlPreviewExecution.ts` ≥ 80, ≤ 250.
2. `wc -l src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 모두 사전 미만 (`<775` / `<579` / `<649`).
3. `wc -l src/components/structure/useDdlPreviewExecution.ts src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 합산 ≤ 2153.
4. `git diff --stat src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` 모두 0 changes.
5. `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx` exit 0 (24 cases 통과).
6. `pnpm vitest run` exit 0, post-Sprint-213 baseline (189 files / 2720 tests) ±1 file 허용.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `grep -n "useDdlPreviewExecution" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 ≥ 6 (3 import + 3 호출).
10. `grep -nE "useState[<(].*previewSql|useState[<(].*previewLoading|useState[<(].*previewError|useState[<(].*pendingConfirm" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 0.
11. `grep -n "pendingExecuteRef" src/components/structure/{IndexesEditor,ConstraintsEditor}.tsx` 매치 0 (hook 내부로 이동).
12. `grep -nE "split\\(\";\"\\)" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 0 (`;`-split hook 안으로).
13. `grep -n "tauri\\." src/components/structure/useDdlPreviewExecution.ts` 매치 0 (Tauri 호출 hook 절대 금지).
14. `grep -n "^export default" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 매치 3건.
15. `grep -rn "from \"@components/structure/useDdlPreviewExecution\"" src/ e2e/` 매치 ≤ 3 (외부 사용 0).
16. `git diff --stat src/components/schema/StructurePanel.tsx` = 0 changes.
17. `git diff src/components/structure/ | grep "^+.*eslint-disable"` 매치 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 (hook 신규 + 3 editor) 의 diff stat.
  - check 1-17 의 실행 결과 (exit code + 핵심 출력).
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary).
  - 새 `eslint-disable*` / silent `catch` 0 임을 git diff 로 보여주기.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 (concrete output).
  - missing 또는 weak evidence 는 finding 으로.

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 행동 변경 0 의 refactor — 신규 unit test 작성 0 권고. Generator 재량으로 `useDdlPreviewExecution.test.ts` 추가 가능 (선택).
- 기존 4 regression test (`ColumnsEditor.test.tsx` 368 + `IndexesEditor.test.tsx` 233 + `ConstraintsEditor.test.tsx` 225 + `SqlPreviewDialog.test.tsx` 126) 가 행동 보존 검증의 source of truth.

### Coverage Target

- 신규 hook 의 직접 unit test 0 (regression test 가 통합 커버) 또는 +5 cases (선택).
- 프로젝트 전체 baseline (라인 40% / 함수 40% / 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — 3 editor 모두 preview → safe → execute → cleanup → onRefresh → history success 사전 동일.
- [x] 에러 / 예외 — preview failure / commit failure / safe mode block / warn confirm / cancel 모두 기존 test 포함.
- [x] 경계 조건 — empty SQL / multiple statements / non-prod skip 모두 기존 test 커버.
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` 전체.

## Test Script / Repro Script

1. baseline 확인:
   ```sh
   pnpm vitest run src/components/structure/ColumnsEditor.test.tsx src/components/structure/IndexesEditor.test.tsx src/components/structure/ConstraintsEditor.test.tsx src/components/structure/SqlPreviewDialog.test.tsx
   ```
2. Generator 작업 후 동일 명령 다시 실행 → exit 0.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint` 전체 회귀.
4. `wc -l src/components/structure/useDdlPreviewExecution.ts src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` 라인 카운트 보고.

## Ownership

- Generator: general-purpose agent (multi-agent harness Phase 3).
- Write scope: `src/components/structure/{useDdlPreviewExecution.ts, ColumnsEditor.tsx, IndexesEditor.tsx, ConstraintsEditor.tsx}` + 선택적 hook unit test. 그 외 파일 (4 regression test / StructurePanel / SqlPreviewDialog 본문 / ConfirmDangerousDialog / 도메인 modal) 변경 금지.
- Merge order: 본 sprint commit → handoff.md → PLAN.md hash → 다음 sprint.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-17 모두)
- Acceptance criteria evidence linked in `handoff.md`
