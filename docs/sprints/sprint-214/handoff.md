# Sprint 214 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- `src/components/structure/useDdlPreviewExecution.ts` (신규, 245 lines) — 공통 DDL preview/execute lifecycle hook. previewSql / previewLoading / previewError / pendingConfirm 4 state + ;-split + useSafeModeGate.decide loop + warn-tier confirm/cancel + history record (`source: "ddl-structure"` / `paradigm: "rdb"` / `queryMode: "sql"` hardcoded) + onRefresh trigger + cancelPreview reset. Tauri 호출 0 (caller closure).
- `src/components/structure/ColumnsEditor.tsx` (775 → 695, -80) — 4 lifecycle useState + runAlter + handleExecute + confirmDangerous + cancelDangerous 제거. handleReviewSql → ddl.loadPreview(req(true), () => async () => { commit + 도메인 cleanup }). handleCancelPending → ddl.cancelPreview() + 도메인 reset.
- `src/components/structure/IndexesEditor.tsx` (579 → 489, -90) — pendingExecuteRef 제거. handleCreateIndexPreview / handleDropIndex 모두 ddl.loadPreview 라우팅.
- `src/components/structure/ConstraintsEditor.tsx` (649 → 559, -90) — IndexesEditor 동일 패턴.
- `docs/sprints/sprint-214/{spec,contract,execution-brief,findings,evaluation,handoff}.md`.

## 다음 sprint = Sprint 215 (P8 Raw-query edit grid)

[`docs/PLAN.md`](../../PLAN.md) post-209 cycle 표:

> | 6 | 215 | refactor | P8 (Raw-query edit grid) | `useRawQueryGridEdit` hook 추출 + commit runner 공유 |

[`docs/archives/etc/refactoring-candidates.md`](../../archives/etc/refactoring-candidates.md) §P8 가 입력값.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `wc -l src/components/structure/useDdlPreviewExecution.ts` | 245 (80 ≤ ≤ 250 ✓) |
| `wc -l src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx` | 695 / 489 / 559 (모두 사전 미만 ✓) |
| 4 파일 합산 | 1988 (≤ 2153 ✓; 사전 2003 → -15 net) |
| `git diff --stat` 4 regression test | 0 changes |
| `pnpm vitest run` 4 regression | 4 files / 26 passed, exit 0 |
| `pnpm vitest run` (full suite) | 189 files / 2720 tests pass, exit 0 |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `grep "useDdlPreviewExecution"` 3 editor | 9 매치 (3 import + 3 호출 + 3 doc comment) ≥ 6 ✓ |
| 4 lifecycle useState 3 editor | 0 매치 ✓ |
| `pendingExecuteRef` Indexes/Constraints | 0 매치 ✓ |
| `split(";")` 3 editor | 0 매치 ✓ |
| `tauri.*` hook | 0 매치 ✓ |
| 3 default export | 3 매치 ✓ |
| hook 외부 import | 3 매치 (3 editor 만) ≤ 3 ✓ |
| `git diff --stat StructurePanel.tsx` | 0 changes |
| 새 `eslint-disable*` 추가 | 0 |

## Acceptance Criteria 결과

- AC-01 hook 파일 80~250 lines + named export ≥ 1 ✓ (245 / `export function useDdlPreviewExecution` + 3 interface)
- AC-02 3 editor hook 사용 + 4 lifecycle useState 0 ✓ (9 매치 / 0 매치)
- AC-03 boilerplate 감소 ✓ (3 editor 모두 사전 미만 / 합산 1988 ≤ 2153 / -15 net)
- AC-04 4 regression test 변경 0 + 26/26 통과 ✓
- AC-05 회귀 0 ✓ (vitest 189/2720 / tsc / lint exit 0; StructurePanel diff 0; eslint-disable 0; silent catch 0)

Evaluator: **PASS 9.5/10** (Correctness 9 / Completeness 10 / Reliability 9 / Verification Quality 10). 6 P3 informational findings (모두 audit 만, blockers 0):

- F-001: contract 의 "24 cases" 기재 vs 실측 baseline 26 cases (Generator 가 정확히 보고).
- F-002: contract check 15 grep 의 `@components/structure/useDdlPreviewExecution` alias 가 project 미노출 — Generator 가 canonical `./useDdlPreviewExecution` 사용 (의도 충족).
- F-003: `runCommit` deps 에 `previewSql` 포함 → identity churn, 행동 영향 0 (Generator 의 residual risk 에 명시).
- F-004: 사전 rapid double-click race 잔존 (out of scope).
- F-005: ColumnsEditor 가 modal mount 후 preview await — byte-equivalent to pre-sprint.
- F-006: 9 grep 매치 중 3 건 doc comment — minimum 6 매치 충족 (doc comment 제거해도).

## 주의 사항

### Hook output shape — closure factory 패턴

`loadPreview(requestPreview, prepareCommit)` 의 `prepareCommit` 은 closure factory (`() => () => Promise<void>`) — 외부 closure 가 호출될 때 inner closure 를 반환. ColumnsEditor 의 도메인 cleanup (pendingChanges/drafts/droppedColumns/editingColumn/showSqlModal reset) 은 inner closure 안에 baked-in. Indexes/Constraints 는 inner closure 안에 `setShowPreviewModal(false)` 정도만.

### History payload tag 3 hardcoded

`source: "ddl-structure"` / `paradigm: "rdb"` / `queryMode: "sql"` 모두 hook 안에 hardcoded — 3 editor 모두 동일 tagging 이라 props 화 안 함. 향후 KV/document DDL editor 추가 시 paradigm prop 추가 필요할 수 있음 (P7 risk note 답습).

### showSqlModal / showPreviewModal editor 잔존

도메인 dialog mount 조건 — spec 의 4 lifecycle state (previewSql/Loading/Error/pendingConfirm) 만 hook 으로 이동. modal open boolean 은 editor 의 도메인 책임.

### 사용자 hooks/lib 병행 작업과 분리

본 sprint 작업 자체는 `src/components/structure/` + `docs/sprints/sprint-214/` 안에 격리. Working tree 의 `src/hooks/{useCommitFlash,useDataGridPreviewCommit,useMigrationExport,useMongoAutocomplete,useSafeModeGate,useSqlAutocomplete}.ts` + `src/lib/{mongo/mongoSafety,mongo/mqlGenerator,perf/bootInstrumentation,safeMode,tauri/document}.ts` + `src/types/connection.ts` 변경은 사용자의 별도 working state — 본 sprint commit 에 미포함.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/structure/ColumnsEditor.test.tsx \
  src/components/structure/IndexesEditor.test.tsx \
  src/components/structure/ConstraintsEditor.test.tsx \
  src/components/structure/SqlPreviewDialog.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
wc -l src/components/structure/useDdlPreviewExecution.ts \
  src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx
grep -n "useDdlPreviewExecution" src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx
grep -nE "useState[<(].*previewSql|useState[<(].*previewLoading|useState[<(].*previewError|useState[<(].*pendingConfirm" \
  src/components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}.tsx  # 0
grep -n "tauri\\." src/components/structure/useDdlPreviewExecution.ts  # 0
```

## 미완 / 후속

- Sprint 215 — P8 (Raw-query edit grid): `useRawQueryGridEdit` hook 추출 + commit runner 공유.
- 본 sprint 후속 candidate (informational):
  - F-003: `runCommit` deps churn — 후속 sprint 에서 useEffect 의존성 최적화 검토.
  - F-005: ColumnsEditor modal/preview 순서 통일 검토 (다른 editor 와 일관성).
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
