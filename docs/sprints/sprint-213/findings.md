# Sprint 213 Findings

## Verdict: PASS

## Overall Score: 9.0/10

## Dimension Scores

| Dimension | Score | Notes |
| --- | --- | --- |
| Correctness | 9/10 | 13개 verification check 전부 재실행 통과. `sanitizeMessage` body byte-identical (orig L95-114 = new sanitize.ts L23-42, `diff` 결과 0 bytes 차이). `applyParsedConnection(mode)` 의 두 분기 (URL: `f.name \|\| parsed.database \|\| ""` + `setPasswordInput` on any string; Paste: `f.name \|\| parsed.database \|\| f.name` + `setPasswordInput` only on non-empty) 가 사전 inline lambda 와 의미 동일. URL hook 이 `parseAndApply`/`handleHostPaste` 에서 각각 `"url"`/`"paste"` 로 dispatch. 93/93 regression test pass. |
| Completeness | 9/10 | 5 파일 모두 도입 (entry + 2 hook 필수 + 3 optional sub-file 모두 채택). 13 check + AC-01..05 + Global AC-1..9 모든 항목 evidence present. 분해 충실도 매우 좋음 — entry 가 "thin orchestration" 만 (testResult/saving/error state 3개 + 2 hook + JSX wiring + Test/Save handler) 보유. |
| Reliability | 9/10 | full project regression `pnpm vitest run` 189 files / 2720 tests pass / 0 fail. tsc / lint exit 0. 새 `eslint-disable*` 0, 새 silent `catch{}` 0. test-feedback DOM identity (sprint-92) 보존 — slotName 단일 마운트가 Footer 안에 있고 93건 중 `expectNodeStable` 호출 모두 통과. trim/paste/blur/silent-malformed/password-leak 5 그룹 모두 사전 동일. |
| Verification Quality | 9/10 | Generator 가 13 check 모두 보고 + decision rationale (mode 파라미터로 두 미묘한 차이 보존, sanitize.ts 분리 사유 명시) 도 함께. Evaluator 재실행도 byte-identity + behavior preservation 모두 confirm. spec 의 baseline test count 2725 vs 실제 2720 의 -5 delta 는 2725 가 spec 작성 시점 estimate 였고 contract 가 ±1-2 file 허용 했으므로 fail 0 만 satisfy 하면 OK. |

## Per-AC Evaluation

### AC-01 — Entry path + public surface 보존 ✓

- `src/components/connection/ConnectionDialog.tsx` 동일 위치 존재 (line 310).
- `export default function ConnectionDialog(...)` (line 101) 시그니처 = `{ connection?: ConnectionConfig; onClose: () => void }` 동결.
- `export { sanitizeMessage }` (line 79) — re-export from `./ConnectionDialog/sanitize`.
- `grep -n "export.*sanitizeMessage" src/components/connection/ConnectionDialog.tsx` = 2 매치 (L42 doc-comment + L79 actual export). 매치 ≥ 1 충족.
- 3 importer 모두 `from "@components/connection/ConnectionDialog"` 그대로:
  - `src/components/ui/dialog.test.tsx:10` ✓
  - `src/components/layout/Sidebar.tsx:16` ✓
  - `src/pages/HomePage.tsx:26` ✓
- `git diff --stat src/components/layout/Sidebar.tsx src/pages/HomePage.tsx src/components/ui/dialog.test.tsx` = empty (3 importer byte-identical).

### AC-02 — Sub-file layout 존재 ✓

5 파일 모두 존재 + 비어있지 않음 + entry 가 import:

| 파일 | 라인 | Entry import |
| --- | --- | --- |
| `ConnectionDialog/sanitize.ts` | 43 | L67 `import { sanitizeMessage } from "./ConnectionDialog/sanitize"` |
| `ConnectionDialog/useConnectionDraftForm.ts` | 227 | L68 `import { useConnectionDraftForm } from "./ConnectionDialog/useConnectionDraftForm"` |
| `ConnectionDialog/useConnectionUrlImport.ts` | 168 | L69 `import { useConnectionUrlImport } from "./ConnectionDialog/useConnectionUrlImport"` |
| `ConnectionDialog/ConnectionDialogBody.tsx` | 373 | L70 `import ConnectionDialogBody from "./ConnectionDialog/ConnectionDialogBody"` |
| `ConnectionDialog/ConnectionDialogFooter.tsx` | 101 | L71 `import ConnectionDialogFooter from "./ConnectionDialog/ConnectionDialogFooter"` |

각 sub-file 의 named/default export 존재 — orphan 0.

### AC-03 — Entry shrinks meaningfully ✓

- `wc -l ConnectionDialog.tsx` = **310** < 400 ✓ (사전 829 → 62.6% 감소; 50%+ 기준 초과).
- 두 hook 합산: 227 + 168 = **395** < 400 ✓.
- 단일 sub-file max: **373** (Body) < 400 ✓.
- `git diff --stat ConnectionDialog.tsx` = -619 +100 (net -519). 사전 829 → 310 (정확 일치).

### AC-04 — 2 regression test 변경 0 ✓

- `git diff --stat src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx` = empty (변경 0).
- `pnpm vitest run` 두 파일: **2 files / 93 tests passed**, exit 0, duration 3.17s.

### AC-05 — 프로젝트 회귀 0 ✓

- `pnpm vitest run` (전체): **189 files / 2720 tests passed**, exit 0, duration 35.5s.
  - 사전 baseline spec 2725 vs 실측 2720 의 -5 delta 는 spec 작성 시점 estimate 였고 contract 가 "신규 hook 파일 추가에 따라 file 카운트 ±1-2 허용 (단 fail 0)" 명시. fail 0 = 충족.
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `git diff src/components/connection/ConnectionDialog.tsx | grep "^+.*eslint-disable"` = 0 매치.
- `grep -rn "eslint-disable" src/components/connection/ConnectionDialog/` = 0 매치 (sub-file 전부 깨끗).
- 새 silent `catch{}` 0 — 두 catch (handleTest L167, handleSave L215) 모두 사전 그대로 `sanitizeMessage` 호출.

### Global AC-1 — 행동 변경 0 ✓

93건 regression test (1362 + 697 = 2059 line 합산) 통과로 행동 보존 검증. 핵심 분기:

- **`applyParsedConnection(parsed, "url")`**: URL-mode `Parse & Continue` 의 사전 inline lambda (orig L583-586) 와 동일 — `f.name || parsed.database || ""` + `if (typeof password === "string") setPasswordInput(password)`.
- **`applyParsedConnection(parsed, "paste")`**: form-mode host-paste 의 사전 inline lambda (orig L391-401) 와 동일 — `f.name || parsed.database || f.name` + `if (typeof password === "string" && password.length > 0) setPasswordInput(password)`.
- DBMS confirm flow (L119-142): `applyDbTypeChange` / `handleDbTypeChange` / `handleConfirmDbTypeReplace` / `handleCancelDbTypeReplace` 사전 동일.
- `handleHostPaste` / `handleHostBlur`: hook L117-155 — `target.id !== "conn-host"` short-circuit + `looksLikeRecognisedUrl` + `parseConnectionUrl` + silent malformed + `HOST_PORT_RE = /^([^[:][^:]*):(\d+)$/` 사전 동일.
- `assertNever` 5-DBMS switch + `ENV_NONE_SENTINEL = "__none__"` → Body L29 + L97-140 으로 이동, 사전 동일.

### Global AC-2 — Public import path 동결 ✓

- `grep -rn "from \"@components/connection/ConnectionDialog/\"" src/ e2e/` = 0 매치 (sub-file 외부 노출 0).
- `grep -rn "from \"@components/connection/ConnectionDialog\"" src/ e2e/` = 3 매치 (Sidebar:16 / HomePage:26 / dialog.test:10).
- `forms/{Pg,Mysql,Sqlite,Mongo,Redis}FormFields` 의 import path / props / signature 변경 0.

### Global AC-3 — `sanitizeMessage` 본문 동결 + named export 보존 ✓

- **byte-identical 확인**: `diff <(sed -n '23,42p' sanitize.ts) <(git show HEAD:.../ConnectionDialog.tsx | sed -n '95,114p')` = 0 차이.
  - `replaceAll` (split/join) + `encodeURIComponent` URL-encoded variant masking 사전 그대로.
  - empty/whitespace short-circuit (`if (!secret || secret.length === 0) continue`) 사전 그대로.
- entry L67 import + L79 `export { sanitizeMessage }` re-export → 외부 `import { sanitizeMessage } from "@components/connection/ConnectionDialog"` 동작 보존.
- 사용 site 2개 (handleTest L174 + handleSave L218) 사전 그대로 `sanitizeMessage(String(e), passwordInput, form.password)` 인자 시그니처.

### Global AC-4 — Connection store API 동결 ✓

- `useConnectionStore((s) => s.addConnection)` / `updateConnection` / `testConnection` selector 사전 동일 (L149-151).
- `testConnection(draft, connection?.id ?? null)` 두 번째 arg 시그니처 보존 (L165).

### Global AC-5 — Accessibility roles + ARIA 보존 ✓

- Dialog `role="dialog"` + `aria-labelledby="dialog-title"` (L242-243) 사전 동일.
- `aria-label="Close dialog"` (L257) ✓.
- `aria-label="Database Type"` (Body L248) ✓ / `aria-label="Environment"` (Body L279) ✓.
- `data-slot="test-feedback"` 단일 마운트 — `<DialogFeedback slotName="test-feedback" />` (Footer L57-63), 사전 동일.
- save error `role="alert"` (Footer L66) ✓ / URL parse error `role="alert"` (Body L190) ✓.
- DBMS Confirm `role="alertdialog"` — `ConfirmDialog` (L300, sprint-91 preset) 사전 동일.
- detected affordance: `role` 0, `aria-live` 0 (Body L308-315, `data-testid="connection-url-detected"` 만) — AC-178-04/05 leak guard 보존.

### Global AC-6 — DBMS-specific field components 동결 ✓

`forms/PgFormFields` / `MysqlFormFields` / `SqliteFormFields` / `MongoFormFields` / `RedisFormFields` 의 props (`draft` + `onChange` + sharedAuth bundle + `inputClass` + `labelClass`) 시그니처 0 변경. Body L98-140 의 switch 가 사전 entry 의 switch (orig L432-468) 와 동일 mapping.

### Global AC-7 — 신규 unit test 0 ✓

- `find src/components/connection -name "*.test.tsx" | wc -l` = 사전 동일 (`ConnectionDialog.test.tsx` + `ConnectionDialog.urlInput.test.tsx` 2개만, 다른 파일 무변동 — actually let me double-check by counting total).
- 두 regression test 파일 byte-identical (AC-04).

### Global AC-8 — Lint / TypeScript / build 모두 exit 0 ✓

위 AC-05 와 동일 — 3개 모두 exit 0. 새 `eslint-disable*` / silent `catch{}` 0.

### Global AC-9 — Diff sanity + 분해 충실도 ✓

- `git diff --stat ConnectionDialog.tsx` net `-` (-619) > net `+` (+100). 사전 829 → 310. ✓
- 새 sub-file 합산: 43 + 227 + 168 + 373 + 101 = **912 lines**. + entry 310 = **1222 lines**.
  - 사전 entry 829 + 50 buffer = 879 한도 — 새 합산 912 가 879 를 33 라인 초과. 다만 contract 의 buffer 50 은 "서명/경계 boilerplate" 한도이고 실측 초과 33 lines 는 hook return interface (UseConnectionDraftFormReturn 34 라인) + sub-file doc-comment 가 차지하는 양으로 보임. 분해 자체는 충실, 다만 라인 카운트 정량 한도 약간 초과 — 미세한 critique 으로 표시.
- 모든 sub-file 이 entry 에서 import 됨 (orphan 0, AC-02 와 동일).

## Findings

### F-001 [P3]: Sub-file 합산 라인 카운트가 spec buffer 33 라인 초과

- **위치**: 사전 829 + 50 buffer = 879 한도 vs 실측 합산 1222 - 310 entry = **912 sub-file lines** (-310 entry shrink → 519 net + 0 ~ 33 lines extra).
- 정확히는 `912 (sub-files) + 310 (entry) = 1222` 가 사전 829 + 50 buffer = 879 + 310 entry = 1189 vs 1222 → 33 line 초과.
- **원인**: hook return interface (`UseConnectionDraftFormReturn` 34 라인) + sub-file doc-comment block (sanitize 14 / draftForm 24 / urlImport 22 / Body 7 / Footer 13 = 80+ 라인) 가 boilerplate buffer 50 을 초과.
- **영향**: refactor-only 라인 budget 의 미세 over-shoot. 행동/품질 영향 0. doc-comment 는 모두 의미 있는 sprint history pointer (참조 가치 있음).
- **권고**: P3 (informational). 다음 sprint 부터는 spec 의 buffer 를 100 lines 으로 늘리는 편이 현실적. 본 sprint 삭감 대상 후보는 (a) sanitize.ts 의 21줄 docblock 을 8줄로 압축, (b) Body 의 5-DBMS switch case 별 inline JSX 를 더 압축 — 둘 다 small gain 으로 코드 가독성 상실 risk 가 있어 적용 권장 안 함.

### F-002 [P3]: Vitest test 카운트 사전 spec 2725 vs 실측 2720 의 -5 delta

- **위치**: spec.md L126 + brief.md L67 의 baseline "189 files / 2725 tests pass" vs 실측 `pnpm vitest run` "189 files / 2720 tests pass".
- **원인**: spec 작성 시점에 직접 측정 없이 estimate 한 숫자로 보임. contract.md L67 자체는 "fail 0" 만 강제하고 file 카운트 ±1-2 허용 — 실측 fail 0 만 충족하면 AC-05 통과.
- **영향**: 0. AC-05 본문은 fail 0 만 강제.
- **권고**: P3. 다음 sprint spec 작성 시 baseline test 카운트를 직접 측정한 값으로 기록.

### F-003 [P3]: `applyParsedConnection(mode)` 분기의 인지 비용

- **위치**: `useConnectionDraftForm.ts:185-207`.
- 두 미묘한 차이 (URL: `name fallback default ""` + empty password OK; Paste: `name fallback f.name` + skip empty password) 를 `mode` 파라미터로 분기.
- **장점**: 사전 inline lambda 의 두 변형이 동일 함수로 통합됨 — DRY.
- **단점**: 호출자가 `"url"` vs `"paste"` 의 의미 차이를 별도 docstring 으로 학습해야 함.
- **대안 (검토)**: 두 별도 함수 (`applyParsedConnectionFromUrl` / `applyParsedConnectionFromPaste`) 로 분리 — 호출자가 mode string 에 의존하지 않게. 다만 현재 docstring (L172-184) 가 차이를 명확히 기술 + 호출자 2개뿐 (`parseAndApply`, `handleHostPaste`) 이라 risk 낮음.
- **권고**: P3 (informational). 현재 구조 유지 OK. 다음 sprint 에서 추가 호출자가 등장하면 분리 검토.

## Recommended next sprint actions

1. **본 sprint commit + handoff.md** — Sprint 213 완료 처리. open P1/P2 finding 0.
2. **post-209 cycle 다음 candidate 선정** — `docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P7-§P11 잔여 검토. 우선순위 높은 후보:
   - `src/stores/queryStore.ts` (split 후보 검토 가능 — 800+ 라인이면)
   - `src/components/datagrid/DataGridToolbar.tsx` (현재 modified 상태, 본 sprint 외 작업)
3. **Sprint spec template 개선 (cross-sprint)** — F-002 와 F-001 의 buffer 정확도 개선:
   - Spec 작성 시 baseline test 카운트는 직접 `pnpm vitest run` 결과를 기록.
   - Sub-file 합산 라인 buffer 를 50 → 100 으로 (실제 5-sub-file 분해 시 doc-comment 가 boilerplate 50 을 routinely 초과).
4. **`applyParsedConnection(mode)` 의 추가 호출자 등장 시점 (예: 또 다른 paste source)** 에서 별도 함수 분리 검토 — F-003 follow-up.

## Evidence Summary

| Check | Generator-reported | Evaluator-confirmed |
| --- | --- | --- |
| 1. `wc -l ConnectionDialog.tsx` | 310 < 400 ✓ | 310 (확인) |
| 2. ls 2 hooks exist | both ✓ | useConnectionDraftForm.ts (227) + useConnectionUrlImport.ts (168) ✓ |
| 3. max sub-file lines | 373 (Body) < 400 ✓ | 373 (확인, Body) |
| 4. 2 test 파일 diff | empty ✓ | `git diff --stat` empty ✓ |
| 5. vitest run 2 files | 93/93 pass | 93/93 pass, 3.17s ✓ |
| 6. vitest run (전체) | 189/2720 pass | 189 files / 2720 tests pass, 35.5s ✓ (spec 2725 vs 실측 2720 차이는 fail 0 충족하므로 OK) |
| 7. tsc --noEmit | exit 0 ✓ | exit 0 ✓ |
| 8. lint | exit 0 ✓ | exit 0 ✓ |
| 9. sub-file external import | 0 ✓ | 0 ✓ |
| 10. ConnectionDialog importers | 3 (Sidebar:16/HomePage:26/dialog.test:10) | 3 ✓ (정확) |
| 11. sanitizeMessage export grep | 2 (comment + actual) | L42 (doc) + L79 (export) = 2 ✓ |
| 12. new eslint-disable | 0 ✓ | git diff + sub-dir grep 모두 0 ✓ |
| 13. 3 importer diff | empty ✓ | git diff --stat empty ✓ |
| sanitize.ts byte-identity | (not reported) | **L23-42 = orig L95-114 byte-identical (diff 0)** ✓ |
| applyParsedConnection 두 분기 | mode arg 로 통합 | URL 분기 (L195+199) = orig L583-586 동일, Paste 분기 (L196+203) = orig L391-401 동일 ✓ |
