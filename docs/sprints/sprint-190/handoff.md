# Sprint 190 — Handoff

Sprint: `sprint-190` (FB-1b — production-tagged 연결에 자동 SafeMode /
Hard auto 정책).
Date: 2026-05-02.
Type: feature.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/lib/safeMode.ts` | `decideSafeModeAction` matrix 진화: production + off + danger → block (prod-auto). 도크스트링에 Sprint 190 정책 명시. |
| `src/lib/safeMode.test.ts` | `[AC-189-06a-5]` (allow) 갱신 → `[AC-190-01-1]` (block + verbatim 카피). 신규 `[AC-190-01-2]` (prod + off + safe → allow). |
| `src/hooks/useSafeModeGate.test.ts` | wiring case "reads mode" 의 분기를 `off → allow` 에서 `warn → confirm` 으로 이동 (off-on-prod 가 더 이상 distinguishing 분기 아님). |
| `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | `[AC-185-04d]` (allow) → `[AC-190-01-3]` (block + 카피). |
| `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` | `[AC-185-05d]` (allow) → `[AC-190-01-4]` (block + 카피). |
| `src/components/query/QueryTab.test.tsx` | `[AC-188-03d]` (dispatch proceeds) → `[AC-190-01-5]` (dispatch blocked + queryState.error verbatim). |
| `src/components/workspace/SafeModeToggle.tsx` | off-mode tooltip 갱신: "No guard" 거짓 → prod-auto 안내. |
| `src/components/workspace/SafeModeToggle.test.tsx` | `[HF-187-A1]` 갱신 — 신규 tooltip verbatim 단언 (newline split 으로 두 정규식). |
| `docs/sprints/sprint-190/contract.md` | 본 sprint contract. |
| `docs/sprints/sprint-190/findings.md` | 8 섹션 (정의 / matrix / 카피 / tooltip / 5 사이트 무변경 / AC 매핑 / Out of Scope / diff 통계). |
| `docs/sprints/sprint-190/handoff.md` | 본 파일. |

총 코드 8 modified, docs 3 신설. **5 사이트 production 코드 (`useDataGridEdit`,
`EditableQueryResultGrid`, `ColumnsEditor`, `IndexesEditor`, `ConstraintsEditor`)
+ `useSafeModeGate.ts` + `safeModeStore.ts` 무변경** — Sprint 189 의
lib/hook 분리 결과로 lib 한 줄 변경이 자동 전파.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-190-01 | `pnpm vitest run src/lib/safeMode.test.ts -t "AC-190-01"` | **2 passed** (block + safe negative). |
| AC-190-01 | `pnpm vitest run src/components/datagrid/useDataGridEdit.safe-mode.test.ts -t "AC-190-01-3"` | **1 passed** (RDB grid commit block). |
| AC-190-01 | `pnpm vitest run src/components/query/EditableQueryResultGrid.safe-mode.test.tsx -t "AC-190-01-4"` | **1 passed** (Query result grid). |
| AC-190-01 | `pnpm vitest run src/components/query/QueryTab.test.tsx -t "AC-190-01-5"` | **1 passed** (Mongo aggregate dispatch block). |
| AC-190-02 | (위 5 케이스의 카피 verbatim 단언이 회귀 가드) | 카피 drift 가드 5건. |
| AC-190-03 | `pnpm vitest run src/hooks/useSafeModeGate.test.ts` | **3 passed** (wiring). |
| AC-190-04 | `pnpm vitest run src/components/workspace/SafeModeToggle.test.tsx` | **6 passed** (tooltip + cycle). |
| Sprint 190 전체 | `pnpm vitest run` + `tsc` + `lint` + `git diff src-tauri/` | **182 files / 2645 tests passed** (+1 vs Sprint 189 baseline 2644); tsc 0 errors; lint 0 warnings; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/lib/safeMode.test.ts \
  src/hooks/useSafeModeGate.test.ts \
  src/components/datagrid/useDataGridEdit.safe-mode.test.ts \
  src/components/query/EditableQueryResultGrid.safe-mode.test.tsx \
  src/components/query/QueryTab.test.tsx \
  src/components/workspace/SafeModeToggle.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / empty diff.

## 후속 (sequencing 계속)

- **Sprint 191** (refactor): SchemaTree 분해 (Sprint 192 export 진입점
  의존성 정리).
- **Sprint 192** (FB-3): DB 단위 export.
- 본 sprint findings §7 의 4개 followup 후보 (strict 카피 정정 / toolbar
  connection-aware visual / per-connection escape / prod-auto telemetry)
  는 별 sprint 단위로 재평가 후 등록 — Sprint 190 closure 시점엔 미결.
