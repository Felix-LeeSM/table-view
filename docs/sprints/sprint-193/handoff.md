# Sprint 193 — Handoff

Sprint: `sprint-193` (`useDataGridEdit` 분해 — 책임별 3개 sub-hook 추출).
Date: 2026-05-02.
Type: refactor.

## Files changed

| 파일 | Purpose |
|------|---------|
| **NEW** `src/hooks/useCommitFlash.ts` | Sprint 98 의 commit flash (Cmd+S 즉시 가시화 + 400ms 안전망 + unmount drain) 를 facade 에서 분리. `{ isCommitFlashing, beginCommitFlash, clearCommitFlash }` 시그니처. contract 의 2 member 에 `clearCommitFlash` 추가 (findings §1). |
| **NEW** `src/hooks/useCommitFlash.test.ts` | `[AC-193-01-1~5]` — 5 case (초기 / sync set / 400ms 자동 false / consecutive cancel / clearCommitFlash 즉시 + drain). |
| **NEW** `src/hooks/useDataGridSelection.ts` | multi-row selection (single / meta-toggle / shift-range / shift-fallback) + selectedRowIdx derivation + clearSelection escape hatch. contract 의 `rowCount` param 제거 (findings §2). |
| **NEW** `src/hooks/useDataGridSelection.test.ts` | `[AC-193-02-1~6]` — 6 case (single / meta-add / meta-remove / shift-range / shift-fallback / clearSelection). |
| **NEW** `src/hooks/useDataGridPreviewCommit.ts` | preview / commit / Safe Mode handoff 전체. paradigm 분기 (RDB SQL preview ↔ Mongo MQL preview), executeQueryBatch / dispatchMqlCommand executor, `useSafeModeGate` consume, runRdbBatch try/catch + cleanup, warn-tier confirmDangerous / cancelDangerous, commitError 라이프사이클. `handleCommit` 시그니처에 `pendingEditsOverride` + `{ opened: boolean }` 결과 추가 (findings §3). |
| `src/components/datagrid/useDataGridEdit.ts` | 1141 → 718 (-423, -37%). 3 sub-hook 의 return 을 묶어 동일 `DataGridEditState` 반환하는 facade 로 축소. cell editing / pending 4-state / dirty tracking / commit-changes 이벤트 listener / row 액션 (Add/Delete/Duplicate) / 단일 `clearAllPending` cleanup callback 보유. |
| `src/components/datagrid/useDataGridEdit.commit-error.test.ts` | static guard 의 `?raw` import 를 useDataGridPreviewCommit 으로 이전 (findings §4). 본문 무변경. |
| `docs/sprints/sprint-193/contract.md` | 본 sprint contract. |
| `docs/sprints/sprint-193/findings.md` | 10 섹션 (시그니처 확장 / param 제거 / handleCommit override / 테스트 위치 이전 / clearAllPending / line count / AC 매핑 / diff 통계 / 4-set / 후속). |
| `docs/sprints/sprint-193/handoff.md` | 본 파일. |

총 코드 5 NEW + 2 modified, docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-193-01 | `pnpm vitest run src/hooks/useCommitFlash.test.ts` | **5 passed** (초기 / sync / 400ms / consecutive / clear+drain). |
| AC-193-02 | `pnpm vitest run src/hooks/useDataGridSelection.test.ts` | **6 passed** (single / meta add+remove / shift range+fallback / clearSelection). |
| AC-193-03 | `pnpm vitest run src/components/datagrid/useDataGridEdit` | **12 files / 118 cases passed** — paradigm × Safe Mode × commitError 분기가 그대로 통과. static guard 도 useDataGridPreviewCommit source 위에서 통과. |
| AC-193-04 | line count + callsite diff | 1141 → 718 (-423, -37%). `git diff --stat src/components/rdb/ src/components/document/` → empty. |
| Sprint 193 전체 | `pnpm vitest run` + `tsc` + `lint` + `git diff src-tauri/` | **185 files / 2663 tests passed** (+2 files, +11 cases vs Sprint 191 baseline 183/2652); tsc 0; lint 0; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/hooks/useCommitFlash.test.ts \
  src/hooks/useDataGridSelection.test.ts \
  src/components/datagrid/useDataGridEdit
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
git diff --stat src/components/rdb/ src/components/document/
```

기대값: 모두 zero error / empty diff / 185 files / 2663 tests.

## 후속 (sequencing 계속)

- **Sprint 194** (feature, Quick Look 편집): 본 sprint 가 정리한 hook
  surface 위에서 quick-look modal 의 편집 진입점이 한 곳에서 dispatch
  가능. paradigm 별 추가 분해는 합류 후 결정.
- **Sprint 195** (refactor): `DataGridTable.tsx` 1071 줄 sibling god
  component 분해 후보. 본 sprint 의 hook surface 위에서 props 컴포넌트
  화가 깨끗하게 진행.
- **Sprint 192** (FB-3 DB 단위 export, 후순위로 미뤄짐) — pg_dump /
  mongodump 도구 가용성이 갖춰지는 시점 재진입.
- finding §10 의 5 followup (test 분할 / DataGridTable 분해 / paradigm
  분리 / MQL pure 추출 / preview-commit 단위 테스트) 은 별 sprint
  단위로 재평가.

## 시퀀싱 메모

- Sprint 189 (D-4 lib pure) → Sprint 190 (FB-1b prod-auto SafeMode) →
  Sprint 191 (SchemaTree decomposition) → **Sprint 193** (useDataGridEdit
  decomposition).
- Sprint 192 (FB-3) 가 실 환경 도구 의존으로 후순위. 192 비워둔 채
  193 까지 진행한 점이 sequencing 의 유일한 일탈.
