# Sprint 210 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- `src/components/document/DocumentDataGrid.tsx` (entry, 597 lines, 951 → -37%) — toolbar / grid / modal wiring + 2 hook 호출 + Add Document handler + Cmd+L Quick Look + edit-cell start + 2 dialog 마운트만 보존.
- `src/components/document/DocumentDataGrid/useDocumentGridData.ts` (175) — `runFind` dispatch + `fetchIdRef` stale guard + `queryIdRef` in-flight tracking + `loading` / `error` 상태 + `fetchData` + `handleCancelRefetch` (synchronous loading drop + best-effort `cancelQuery`) + `TableData` 프로젝션.
- `src/components/document/DocumentDataGrid/useMongoBulkOps.ts` (263) — Safe Mode gate (`safeModeGate.decide(analyzeMongoOperation(...))`) + JSON patch parse + `_id` rejection + `invokeDeleteMany` / `invokeUpdateMany` + toast + `addHistoryEntry` (`source: "mongo-op"`, identical timing) + 성공 후 refetch.
- `src/components/document/DocumentDataGrid/DocumentBulkDeleteDialog.tsx` (88) — presentational. Title / description / filter pre-block / Cancel + destructive Confirm 버튼, aria-labels / loading copy 동일.
- `src/components/document/DocumentDataGrid/DocumentBulkUpdateDialog.tsx` (112) — presentational. Title / description / filter pre-block / patch JSON `<textarea>` (placeholder `{ "status": "archived" }`) / parse error alert / Cancel + Confirm, aria-labels / loading copy 동일.
- `docs/sprints/sprint-210/{spec,contract,execution-brief,findings,handoff}.md`.
- `docs/PLAN.md` Sprint 210 ✓ + commit hash.

## 다음 sprint = Sprint 211

[`docs/PLAN.md`](../../PLAN.md) line 113 (post-209 cycle 표):

> | 2 | 211 | refactor | P2 (QuickLookPanel) | `QuickLookShell` 분리 + RDB / Document body 분리 + helpers 이동. |

[`docs/archives/etc/refactoring-candidates.md`](../../archives/etc/refactoring-candidates.md) §P2 가 입력값.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `wc -l src/components/document/DocumentDataGrid.tsx` | 597 (< 600 ✓) |
| `ls src/components/document/DocumentDataGrid/{useDocumentGridData.ts,useMongoBulkOps.ts,DocumentBulkDeleteDialog.tsx,DocumentBulkUpdateDialog.tsx}` | 4/4 존재 |
| `git diff --stat src/components/document/DocumentDataGrid.{,pagination.,refetch-overlay.}test.tsx` | 0 changes |
| `pnpm vitest run` (3 regression files) | 27/27 pass, exit 0 |
| `pnpm vitest run` (full suite) | 189 files / 2725 tests pass, exit 0 |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `grep "from \"@components/document/DocumentDataGrid/\"" src/ e2e/` | 0 매치 (sub-files internal) |
| `grep "from \"@components/document/DocumentDataGrid\"" src/ e2e/` | `MainArea.tsx:8` (변경 0) |

## Acceptance Criteria 결과

- AC-01 entry path + public props 보존 ✓
- AC-02 5 파일 모두 존재 + 비어있지 않음 ✓
- AC-03 entry 597 < 600 ✓; 단일 sub-file max 263 < 400 ✓
- AC-04 3 regression test 파일 0 변경 + 통과 ✓
- AC-05 회귀 0 (vitest / tsc / lint exit 0; 새 `eslint-disable` 0) ✓

Evaluator: **PASS 9/10** (Correctness 9 / Completeness 9 / Reliability 9 / Verification Quality 9). 두 P3 informational finding 만:
- F-001: spec 의 "189 files / 2737 tests" baseline 은 stale — 실제 main = 189 files / 2725 tests (사용자 병행 commit `0d1835f` / `b327227` / `c79ca65` 영향). working state 대 main 동등 유지로 회귀 0.
- F-002: hook 시그니처가 contract 의 "minimal surface" 가이드보다 약간 넓음 — 후속 sprint 에서 정밀화 candidate.

## 주의 사항

### baseline 차이 (informational)

contract / execution-brief 의 "189 files / 2737 tests" 는 Sprint 209 종료 직후 수치. 이후 사용자가 b327227 (envelope crypto) / c79ca65 (tabStore 209+) / 0d1835f (drag-drop fix) 등 commit 을 push 했고 그 사이 일부 test 가 정리됨. 현 main baseline = 189 files / 2725 tests. 본 sprint 는 해당 baseline 동등하게 유지.

### Add Document flow 는 entry 에 보존

contract 의 `useMongoBulkOps` 는 `deleteMany` / `updateMany` 한정. Add Document 는 단일 document insert + `addHistoryEntry` call site 가 entry-owned state (`addModalOpen`, `addLoading`, `addError`) 옆에 위치해 자연스러운 entry concern. 후속 sprint 에서 `useAddDocument` hook 추출 candidate.

### 사용자 병행 작업과의 격리

본 sprint 작업 중 unstaged 영역 발견 안됨 (working tree clean). 사용자 병행 작업은 commit 단위로 정리됨.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/document/DocumentDataGrid.test.tsx \
  src/components/document/DocumentDataGrid.pagination.test.tsx \
  src/components/document/DocumentDataGrid.refetch-overlay.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
wc -l src/components/document/DocumentDataGrid.tsx \
  src/components/document/DocumentDataGrid/*.{ts,tsx}
grep -rn "from \"@components/document/DocumentDataGrid/" src/ e2e/  # 0
grep -rn "from \"@components/document/DocumentDataGrid\"" src/ e2e/ # MainArea.tsx 1
```

## 미완 / 후속

- Sprint 211 — P2 QuickLookPanel.tsx 분해 (`QuickLookShell` + RDB / Document body 분리 + helpers 이동).
- 본 sprint 후속 candidate:
  - Add Document flow → `useAddDocument` hook 추출.
  - 테이블 body 를 5번째 sub-file 로 추출 (entry 의 `<table>` block ~165 lines).
  - hook signature 정밀화 (F-002).
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
