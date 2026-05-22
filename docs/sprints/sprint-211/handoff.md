# Sprint 211 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- `src/components/shared/QuickLookPanel.tsx` (entry, 176 lines, 868 → -79.7%) — 3 props types named exports + cross-paradigm state (`height` / `editing` / `firstSelectedId`) + shared resize handlers (`handleResizeMouseDown` / `handleResizeKeyDown`) + `mode` discriminator 분기.
- `src/components/shared/QuickLookPanel/QuickLookShell.tsx` (134) — presentational shell (region wrapper + resize handle role/aria + header chrome + HeaderControls inline + body slot). `resizeHandleClassName` optional prop 으로 document-mode `dark:bg-muted/20` variant 보존.
- `src/components/shared/QuickLookPanel/RdbQuickLookBody.tsx` (137) — RDB title (`Row Details — schema.table` + multi-select suffix) + per-column `FieldRow` list + local `BlobViewerDialog` wiring + out-of-bounds `null` return.
- `src/components/shared/QuickLookPanel/DocumentQuickLookBody.tsx` (143) — namespace title (`Document Details — database.collection` + multi-select suffix) + read-only `BsonTreeViewer` 경로 + edit `FieldRow` over synthesized columns 경로 + `editing && data` gate.
- `src/components/shared/QuickLookPanel/helpers.ts` (105) — pure helpers (`formatCellValue` / `isBlobColumn` / `isJsonColumn` / `isBoolColumn` / `looksLikeJson` / `isEditableColumn` / `selectedRowIsDirty` / `clampHeight`) + 4 height constants (`MIN_HEIGHT=120` / `MAX_HEIGHT=600` / `DEFAULT_HEIGHT=280` / `KEYBOARD_RESIZE_STEP=8`). 기존 `formatCellValue` 의 `JSON.stringify` cycle / `JSON.parse` swallow 코멘트 verbatim 보존.
- `src/components/shared/QuickLookPanel/FieldRow.tsx` (333) — **5번째 sub-file**. `FieldRow` + `EditableValue` JSX 컴포넌트. helpers 와 동일 디렉토리 colocation 유지 + JSX 가 `.ts` 에서 파싱 안 되는 `@vitejs/plugin-react` 제약 우회.
- `docs/sprints/sprint-211/{spec,contract,execution-brief,findings,handoff}.md`.
- `docs/PLAN.md` Sprint 211 ✓ + commit hash.

## 다음 sprint = Sprint 212 (예정 — 본 cycle 사용자 지시로 211 까지)

> 사용자 지시: "211까지만 하고 멈춰줘." — 본 cycle 자동 진행 종료.

차후 재개 시 [`docs/PLAN.md`](../../PLAN.md) post-209 cycle 표 line 114:

> | 3 | 212 | refactor | P3 (tabStore cross-store) | tabStore 의 schemaStore / queryHistoryStore 직접 import 끊고 dispatcher 패턴 도입. |

[`docs/archives/backlogs/refactoring-candidates-2026-05-06.md`](../../archives/backlogs/refactoring-candidates-2026-05-06.md) §P3 가 입력값.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `wc -l src/components/shared/QuickLookPanel.tsx` | 176 (< 250 ✓, 868 → -79.7%) |
| `ls src/components/shared/QuickLookPanel/{QuickLookShell.tsx,RdbQuickLookBody.tsx,DocumentQuickLookBody.tsx,helpers.ts}` | 4/4 존재 |
| `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` 단일 max | 333 (FieldRow.tsx) < 400 ✓ |
| `git diff --stat src/components/shared/QuickLookPanel.test.tsx` | 0 changes |
| `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` | 51/51 pass, exit 0 |
| `pnpm vitest run` (full suite) | 189 files / 2725 tests pass, exit 0 |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `grep "from \"@components/shared/QuickLookPanel/\"" src/ e2e/` | 0 매치 (sub-files internal) |
| `grep "from \"@components/shared/QuickLookPanel\"" src/ e2e/` | 2 매치 (`DataGrid.tsx:26` + `DocumentDataGrid.tsx:6`, 변경 0) |
| `grep "export interface QuickLookPanelRdbProps\|...DocumentProps\|export type QuickLookPanelProps" entry` | 3 매치 (L56/66/82) |
| `git diff` 변경 파일 grep `^+.*eslint-disable` | 0 추가 |

## Acceptance Criteria 결과

- AC-01 entry path + public surface (default export + 3 props types named exports) 보존 ✓
- AC-02 5 파일 모두 존재 + 비어있지 않음 ✓ (+ 5번째 sub-file FieldRow.tsx — informational deviation)
- AC-03 entry 176 < 250 ✓; 단일 sub-file max 333 < 400 ✓
- AC-04 `QuickLookPanel.test.tsx` 0 변경 + 51/51 통과 ✓
- AC-05 회귀 0 (vitest / tsc / lint exit 0; 새 `eslint-disable*` 0) ✓

Evaluator: **PASS 8.5/10** (Correctness 9 / Completeness 8 / Reliability 9 / Verification Quality 8). 3 P3 informational findings:
- F-001: 6번째 파일 `FieldRow.tsx` 추가 — `@vitejs/plugin-react` 가 `.ts` 에서 JSX 파싱 안 함. helpers.ts 에 강제로 넣으면 462 lines → 400-line cap 위반. AC-02 의 "5 파일 존재" 조항은 만족. 후속 spec 작성 시 JSX/non-JSX 분리 명시할 lesson.
- F-002: entry 가 RDB out-of-bounds 시 short-circuit 안 함 — child `RdbQuickLookBody` 가 `null` return. 행동 보존, micro-optimization 만.
- F-003: `editing` state 가 `props.mode` 전환 후에도 살아남음. 현 call site 가 mode 동적 전환 안 해서 행동 동일.

## 주의 사항

### 5번째 sub-file 추가 (informational deviation)

contract / execution-brief 의 "4 sub-file" framing 은 `FieldRow` + `EditableValue` 를 `helpers.ts` 안에 두는 가정. 실제 시도하면:
- `helpers.ts` 가 462 lines → 400-line cap (AC-03) 위반.
- `helpers.ts` 를 `helpers.tsx` 로 rename → AC-02 의 literal "helpers.ts" 매치 실패.

선택: `FieldRow.tsx` (333 lines) 를 5번째 sub-file 로 분리. 모든 hardcoded check 1-12 통과. Evaluator 가 informational 로 판정.

### 사용자 병행 작업과의 격리

본 sprint 작업 중 unstaged 영역 발견 안됨 (working tree clean).

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/shared/QuickLookPanel.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
wc -l src/components/shared/QuickLookPanel.tsx \
  src/components/shared/QuickLookPanel/*.{ts,tsx}
grep -rn "from \"@components/shared/QuickLookPanel/" src/ e2e/  # 0
grep -rn "from \"@components/shared/QuickLookPanel\"" src/ e2e/ # 2
```

## 미완 / 후속

- **본 cycle 진행 일시 정지** (사용자 지시 "211까지만 하고 멈춰줘"). post-209 cycle Sprint 212-220 (P3-P11) 재개 시점은 사용자 결정.
- 후속 spec 작성 시: JSX 컴포넌트와 non-JSX helper 분리를 명시 (lesson: F-001).
- 후속 sprint candidate (informational): entry RDB out-of-bounds short-circuit (F-002), `editing` state mode-switch 보호 (F-003) — 모두 행동 보존.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
