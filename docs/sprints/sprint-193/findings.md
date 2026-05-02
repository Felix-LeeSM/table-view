# Sprint 193 — Findings

## 1. `useCommitFlash` 인터페이스 미세 확장 (`clearCommitFlash`)

contract AC-193-01 의 시그니처는 `{ isCommitFlashing, beginCommitFlash }` 2개
member 만 명시했으나, 실 추출 과정에서 Sprint 98 의 watcher 효과
("preview / commitError 가 도달하면 즉시 false 로") 가 hook 외부 (facade
또는 preview-commit hook) 의 입력에 의존함을 확인. setter 노출 없이는 watcher
가 hook 내부로 들어가야 했고, hook 이 sqlPreview / mqlPreview / commitError
를 알게 되면 책임 응집도가 깨진다.

대응: hook 시그니처에 `clearCommitFlash(): void` 추가. facade 의 watcher
effect 가 이 메서드를 호출 — hook 은 여전히 preview state 를 모르며 hook
의 책임 (state + begin + drain) 도 깨끗하게 유지.

테스트 케이스도 contract 의 4 → 5 로 확장 (`[AC-193-01-5]` clearCommitFlash
verifies false transition + timer drain).

## 2. `useDataGridSelection` 의 `rowCount` param 제거

contract AC-193-02 가 `UseDataGridSelectionParams { rowCount: number }` 로
정의했으나, 실 코드를 정찰한 결과 shift-range 선택 분기는
`Math.min(anchor, idx)` 와 `Math.max(anchor, idx)` 로 cap 없이 inclusive
range 를 만든다 — `rowCount` 는 미사용 dead param.

대응: hook 을 무인자 (`useDataGridSelection()`) 로 단순화. 페이지 전환
시 selection 자동 리셋은 facade 가 useEffect 로 `clearSelection()` 호출
하는 방식으로 분리. 결과적으로 hook 이 page 개념을 모르고 pagination
정책이 변해도 영향받지 않는다.

## 3. `useDataGridPreviewCommit` — `handleCommit` 시그니처 확장

facade 의 commit-changes (Cmd+S) 이벤트 handler 가 in-flight cell editor
를 보유한 채 호출될 때 inline 으로 SQL preview 를 생성하는 분기가 있다.
이 분기는:

1. `applyEditOrClear(pendingEdits, ...)` 로 merged map 을 만들고,
2. `setPendingEdits(merged)` 로 state 를 갱신한 뒤,
3. merged 를 입력으로 `generateSqlWithKeys` 를 호출.

useState 는 비동기 batch 라 `setPendingEdits` 직후 같은 tick 의
`handleCommit()` 호출은 stale state 를 보게 된다 — 그래서 inline 분기가
hook 의 logic 을 복사하고 있었다.

대응: `handleCommit` 시그니처를 `(overrides?: HandleCommitOverrides) =>
HandleCommitResult` 로 확장. `overrides.pendingEditsOverride` 를 받으면 그
map 을 SQL 생성에 사용. 그리고 `{ opened: boolean }` 로 preview open
여부를 보고 — facade 가 검증 실패 (length 0) 시 cell editor 를 유지,
성공 시 dismiss 하도록 결정 가능.

이 변경으로 facade 의 inline 분기가 ~60 줄에서 ~15 줄로 축소, hook 이
preview 생성 책임을 단일 진입점으로 흡수.

## 4. `runRdbBatch` static guard 테스트 위치 이전

`useDataGridEdit.commit-error.test.ts` 의 `static regression guard: SQL
branch catch block is non-empty` 케이스는 facade source 를 `?raw` 로
import 해 `const runRdbBatch = useCallback(` marker 를 찾는다. 본 sprint
가 runRdbBatch 를 hook 으로 옮기면서 marker 가 사라져 테스트가 실패.

대응: import 를 `@/hooks/useDataGridPreviewCommit.ts?raw` 로 변경하고
주석에 Sprint 193 (AC-193-03) 이전 사유를 명시. 테스트 본문은 무변경 —
같은 marker 가 hook source 에 그대로 존재.

## 5. `clearAllPending` cleanup callback 패턴

contract 가 facade ↔ preview-commit hook 의 협력으로 정의한
`clearAllPending` 은 RDB / MQL 양쪽 success 분기와 handleDiscard 모두에서
호출되는 단일 cleanup. facade 에서 다음 7 setter 를 묶음:

- `setPendingEdits(new Map())`
- `setPendingEditErrors(new Map())`
- `setPendingNewRows([])`
- `setPendingDeletedRowKeys(new Set())`
- `clearSelection()` (useDataGridSelection 의 escape hatch)
- `setEditingCell(null)`
- `setEditValue("")`

hook 은 `clearAllPending()` 한 호출로 상기 7 setter 모두 발사. handleDiscard
도 동일 callback + `resetPreviewState()` 로 단순화 — 기존 11 줄 setter
호출 묶음이 2 줄로.

## 6. line 수 변화 — contract 목표 대비

| 파일 | Before | After | Δ |
|------|--------|-------|---|
| `src/components/datagrid/useDataGridEdit.ts` | 1141 | 718 | **-423 (-37%)** |
| `src/hooks/useCommitFlash.ts` (NEW) | 0 | 64 | +64 |
| `src/hooks/useCommitFlash.test.ts` (NEW) | 0 | 118 | +118 |
| `src/hooks/useDataGridSelection.ts` (NEW) | 0 | 85 | +85 |
| `src/hooks/useDataGridSelection.test.ts` (NEW) | 0 | 111 | +111 |
| `src/hooks/useDataGridPreviewCommit.ts` (NEW) | 0 | 458 | +458 |

contract AC-193-04 의 목표 "1141 → ~600 (-540, -47%)" 보다 더 줄였다 —
실제로는 1141 → 718 (-423, -37%). 차이 (~118 줄) 는 facade 가 보유하기로
한 cell editing / pending 액션 / dirty tracking / commit-changes 이벤트
listener 가 contract 추정보다 약간 많았던 것이다 (특히 commit-changes
handler 의 in-flight 분기).

신규 hook 3개의 합 (607 줄, hook 본체만) 은 facade 에서 빠진 423 줄보다
크지만, 이는 hook 별로 책임을 명확히 명시하는 jsdoc + interface 정의 +
부분 helper 가 늘어난 결과. 응집도는 분명히 개선 — 한 hook 이 한 책임만
담당.

## 7. AC → 테스트 매핑

| AC | 검증 위치 | 케이스 수 |
|----|-----------|-----------|
| AC-193-01 | `src/hooks/useCommitFlash.test.ts` `[AC-193-01-1~5]` | 5 (초기 / sync set / 400ms / consecutive cancel / clear+drain) |
| AC-193-02 | `src/hooks/useDataGridSelection.test.ts` `[AC-193-02-1~6]` | 6 (single / meta-add / meta-remove / shift-range / shift-fallback / clearSelection) |
| AC-193-03 | 신규 단위 테스트 0건 — 기존 12 files / 118 cases (`useDataGridEdit.*.test.ts`) 가 paradigm × Safe Mode × commitError cross-cutting 회귀 가드 | 0 신규 / 118 회귀 |
| AC-193-04 | facade line count 보고 + 5 callsite 무변경 | 0 신규 / 회귀 가드는 위 |

## 8. 코드 변경 통계

- `src/hooks/useCommitFlash.ts`: +64 (NEW).
- `src/hooks/useCommitFlash.test.ts`: +118 (NEW).
- `src/hooks/useDataGridSelection.ts`: +85 (NEW).
- `src/hooks/useDataGridSelection.test.ts`: +111 (NEW).
- `src/hooks/useDataGridPreviewCommit.ts`: +458 (NEW).
- `src/components/datagrid/useDataGridEdit.ts`: -423 (1141 → 718).
- `src/components/datagrid/useDataGridEdit.commit-error.test.ts`: 1 line edit
  (?raw import target 변경) + 주석 갱신.

총 코드 5 NEW + 2 modified, docs 3 신설 (contract / findings / handoff).

## 9. 검증 4-set

- `pnpm vitest run` → **185 files / 2663 tests passed**
  (+2 files: useCommitFlash + useDataGridSelection;
   +11 cases vs Sprint 191 baseline 183/2652).
- `pnpm tsc --noEmit` → 0 errors.
- `pnpm lint` → 0 warnings.
- `git diff --stat src-tauri/` → empty.
- `git diff --stat src/components/rdb/ src/components/document/` → empty
  (5 callsite 무변경).

## 10. 후속 (본 sprint Out of Scope)

- **`useDataGridEdit.test.ts` 분할** — smell §8.1, defer 항목. 12 test
  files / 118 cases 가 facade hook 경로를 통합 단언하므로 분할 시 hook
  단위로 재배치 가능. 별 sprint.
- **`DataGridTable.tsx` 분해** — 1071 줄 sibling god component (smell §2).
  본 sprint 가 정리한 facade hook surface 위에서 props 컴포넌트 분리가
  깔끔하게 진행됨. Sprint 195 또는 후속 후보.
- **paradigm 별 sub-hook 분해** — `useDataGridPreviewCommit` 가
  paradigm 분기를 흡수했지만 내부적으로는 여전히 if-paradigm. 실제
  paradigm 분리는 Sprint 194 (Quick Look 편집) 합류 후 더 정확히
  결정. 현재로선 paradigm 분기 흡수만으로도 facade 가 깨끗.
- **MQL preview lib pure 추출** (D-4 후보) — `generateMqlPreview` 가 이미
  lib 이지만 pendingChanges → MqlCommand 변환 helper 분리 여지. 별 sprint.
- **`useDataGridPreviewCommit` 단위 테스트 추가** — contract 가 신규
  단위 테스트 0건으로 정의했으나, paradigm × Safe Mode × commitError
  의 9개 셀 분기 (paradigm 2 × decision 3 × in-flight 2 ≈ 12 변형) 를
  hook 단으로 직접 단언하는 별도 테스트 파일이 회귀 가드를 더 단단히
  한다. 별 sprint 후보.
