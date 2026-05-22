# Sprint 213 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- `src/components/connection/ConnectionDialog.tsx` (entry, 310 lines, 829 → -62.6%) — testResult / saving / error state + 2 hook 호출 + Header / Body / Footer wiring + ConfirmDialog mount + `sanitizeMessage` re-export.
- `src/components/connection/ConnectionDialog/sanitize.ts` (43) — `sanitizeMessage` 본체. replaceAll + URL-encoded 마스킹 byte-identical.
- `src/components/connection/ConnectionDialog/useConnectionDraftForm.ts` (227) — draft state + passwordInput / clearPassword + DB type confirmation flow + `applyDbTypeChange` (Sprint 138 defaults) + `resolvePassword` + `trimDraft` + `applyParsedConnection(parsed, mode)`.
- `src/components/connection/ConnectionDialog/useConnectionUrlImport.ts` (168) — URL parse + paste detection + host:port blur split. `RECOGNISED_SCHEMES` / `looksLikeRecognisedUrl` / `HOST_PORT_RE` 사전 동일.
- `src/components/connection/ConnectionDialog/ConnectionDialogBody.tsx` (373) — presentational form/URL toggle + URL input + Form mode (Name / Database Type / Environment / `renderDbmsFields` 5-DBMS switch / detected affordance / Advanced Settings). `assertNever` switch + `ENV_NONE_SENTINEL` 호스팅.
- `src/components/connection/ConnectionDialog/ConnectionDialogFooter.tsx` (101) — presentational `<DialogFeedback slotName="test-feedback">` + save error `role="alert"` + Test/Cancel/Save footer.
- `docs/sprints/sprint-213/{spec,contract,execution-brief,findings,handoff}.md`.

## 다음 sprint = Sprint 214 (P7 Structure editors)

[`docs/PLAN.md`](../../PLAN.md) post-209 cycle 표:

> | 5 | 214 | refactor | P7 (Structure editors) | `useDdlPreviewExecution` 공통 hook + 3 editor (columns/indexes/constraints) 적용 |

[`docs/archives/backlogs/refactoring-candidates-2026-05-06.md`](../../archives/backlogs/refactoring-candidates-2026-05-06.md) §P7 가 입력값.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `wc -l src/components/connection/ConnectionDialog.tsx` | 310 (< 400 ✓, 829 → -62.6%) |
| `ls src/components/connection/ConnectionDialog/{useConnectionDraftForm.ts,useConnectionUrlImport.ts}` | 2/2 존재 (필수) |
| `wc -l src/components/connection/ConnectionDialog/*.{ts,tsx}` 단일 max | 373 (Body) < 400 ✓ |
| `git diff --stat src/components/connection/ConnectionDialog.test.tsx urlInput.test.tsx` | 0 changes |
| `pnpm vitest run` (regression 2 files) | 93/93 pass, exit 0 |
| `pnpm vitest run` (full suite) | 189 files / 2720 tests pass, exit 0 |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `grep "from \"@components/connection/ConnectionDialog/\"" src/ e2e/` | 0 매치 (sub-files internal) |
| `grep "from \"@components/connection/ConnectionDialog\"" src/ e2e/` | 3 매치 (`Sidebar.tsx:16` + `HomePage.tsx:26` + `dialog.test.tsx:10`) |
| `grep "export.*sanitizeMessage" src/components/connection/ConnectionDialog.tsx` | 2 매치 (코멘트 + actual export) |
| 새 `eslint-disable*` 추가 | 0 |
| `git diff --stat` 3 importers (Sidebar / HomePage / ui/dialog.test) | 0 changes |

## Acceptance Criteria 결과

- AC-01 entry path + public surface 보존 ✓ (default export + `sanitizeMessage` named export + props 동결)
- AC-02 5 sub-file 모두 존재 + 비어있지 않음 ✓ (sanitize / draftForm / urlImport / Body / Footer)
- AC-03 entry 310 < 400 ✓; 단일 sub-file max 373 < 400 ✓
- AC-04 2 regression test 파일 0 변경 + 93/93 통과 ✓
- AC-05 회귀 0 (vitest / tsc / lint exit 0; 새 `eslint-disable*` 0) ✓

Evaluator: **PASS 9/10** (Correctness 9 / Completeness 9 / Reliability 9 / Verification Quality 9). 3 P3 informational findings (모두 audit 만, 회귀 0):
- F-001: 새 sub-file 합산 912 lines vs spec buffer 879 — 33 lines 초과 (doc-comment 풍부화). 다음 sprint buffer 100 lines 권고.
- F-002: spec baseline test count 2725 vs 실측 2720 (-5 delta from Sprint 212 stale test 삭제 반영).
- F-003: `applyParsedConnection(mode)` 분기의 인지 비용. 호출자 2개라 risk 낮음.

## 주의 사항

### `applyParsedConnection(parsed, mode: "url" | "paste")` 의식적 분기

사전 코드의 두 inline lambda (URL `Parse & Continue` 와 form mode host paste) 가 미묘하게 달랐음:
- name fallback default: URL 모드는 `f.name || database || ""`, paste 모드는 `f.name || database || f.name`.
- 빈 string password 처리: URL 모드는 모든 string 허용, paste 모드는 length > 0 만.

Generator 가 `applyParsedConnection(parsed, mode)` 의 `mode` 파라미터로 두 분기 가지 보존 — 의도적 (사전 의미 보존). 후속 sprint 에서 통일 시도할 경우 본 sprint 의 분기 보존 의도를 JSDoc 으로 마킹해둠.

### Optional sub-file 모두 도입

contract 가 body / footer / sanitize.ts 분리를 generator 재량으로 둠. Generator 가 셋 전부 도입 — entry 가 310 라인 안정 + 책임 명확. spec budget 약간 초과 (912 vs 879, F-001 P3).

### 사용자 datagrid cleanup (별도, scope 외)

Working tree 에 9개 datagrid 파일 (BlobViewerDialog / CellDetailDialog / DataGridTable / DataGridToolbar / sqlGenerator / useDataGridEdit / etc.) doc-comment 정리 변경 (sprint history reference 일반화) — 본 sprint commit 에 미포함, 사용자 working state 로 잔존.

### 사용자 병행 작업과의 격리

본 sprint 작업 자체는 ConnectionDialog 디렉토리 안에 격리. 사용자 datagrid cleanup 은 별도 commit 으로 처리될 예정.

## 검증 명령 (재현)

```sh
pnpm vitest run src/components/connection/ConnectionDialog.test.tsx \
  src/components/connection/ConnectionDialog.urlInput.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
wc -l src/components/connection/ConnectionDialog.tsx \
  src/components/connection/ConnectionDialog/*.{ts,tsx}
grep -rn "from \"@components/connection/ConnectionDialog/" src/ e2e/  # 0
grep -rn "from \"@components/connection/ConnectionDialog\"" src/ e2e/ # 3
grep -n "export.*sanitizeMessage" src/components/connection/ConnectionDialog.tsx  # ≥ 1
```

## 미완 / 후속

- Sprint 214 — P7 (Structure editors): `useDdlPreviewExecution` 공통 hook 추출 + 3 editor (columns/indexes/constraints) 적용.
- 본 sprint 후속 candidate (informational):
  - F-001: spec budget buffer 50 → 100 라인 (doc-comment 풍부화 허용).
  - F-003: `applyParsedConnection(mode)` 호출자 3+ 등장 시 별도 함수 분리 검토.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.
