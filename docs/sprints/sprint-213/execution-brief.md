# Sprint Execution Brief: sprint-213

## Objective

`src/components/connection/ConnectionDialog.tsx` (829 lines) 를 entry-pattern 으로 분해. 두 hook (`useConnectionDraftForm`, `useConnectionUrlImport`) 추출 (필수) + 선택적 `ConnectionDialogBody` / `ConnectionDialogFooter` / `sanitize.ts` 분리. entry 는 testResult / saving / error state + 2 hook 호출 + JSX wiring 만 보존. 행동 변경 0.

## Task Why

- post-209 cycle 의 P6 후보. `refactoring-candidates.md` §P6 명시.
- credential policy + 800+ JSX layout 가 같은 scope → password leak 방어 로직 수정 시 unrelated form layout 까지 reading cost.
- form-mode paste detection 과 URL-mode parse flow 가 비슷한 pipeline 인데 별도 inline lambda 로 직조됨.
- DBMS-specific field components (`forms/PgFormFields` 등) 는 이미 분리됐지만 dialog-level form state machine 은 여전히 central component 에 집중.
- Sprint 199 / 200 / 201 / 210 / 211 / 212 entry-pattern 답습 — 비용/위험 통제.
- 2 regression test (1362 + 697 = 2059 lines) 가 source-of-truth.

## Scope Boundary

- `ConnectionDialog.tsx` + 신규 `ConnectionDialog/` 디렉토리만 수정.
- `ConnectionDialog.test.tsx` (1362) / `ConnectionDialog.urlInput.test.tsx` (697) 변경 금지.
- `useConnectionStore` (`addConnection` / `updateConnection` / `testConnection`) API 변경 금지.
- `forms/{Pg,Mysql,Sqlite,Mongo,Redis}FormFields` / `parseConnectionUrl` / `parseSqliteFilePath` / `DialogFeedback` API 변경 금지.
- 3 importer (`Sidebar.tsx` / `HomePage.tsx` / `dialog.test.tsx`) 변경 금지.
- `sanitizeMessage` 본문 (replaceAll + URL-encoded 마스킹) 변경 금지.
- 새 feature, 새 동작, 새 테스트 작성 금지.

## Invariants

- 외부 import path: `@components/connection/ConnectionDialog` 가 default React 컴포넌트 + `sanitizeMessage` named export. props = `{ connection?: ConnectionConfig; onClose: () => void }` 동결.
- 4 sub-file (max) 은 entry 또는 다른 sub-file 로부터만 import (외부 노출 0).
- sprint-92 `expectNodeStable` DOM identity 4건 + sprint-95 DialogFeedback 매핑 + sprint-108 DBMS port confirm + sprint-138 5-DBMS form shape + sprint-178 5 그룹 (trim / paste / blur / silent malformed / password leak) 모두 사전 동일.
- `data-slot="test-feedback"` / `data-testid="connection-url-detected"` / DBMS Confirm `role="alertdialog"` / save error `role="alert"` / detected affordance role 0 (AC-178-04) 그대로.
- `testConnection(draft, connection?.id ?? null)` 두 번째 arg 시그니처 보존.
- 새 `eslint-disable*` / silent `catch{}` 0 (sanitize 호출하는 catch 는 silent 아님).

## Done Criteria

1. 5 파일 (entry + 2 hook + 0~3 선택) 모두 존재 + 비어있지 않음.
2. entry < 400 lines, 단일 sub-file < 400 lines.
3. 2 regression test 변경 0 + `pnpm vitest run` 으로 통과.
4. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0.
5. 3 importer 변경 0 / `sanitizeMessage` named export 보존 / 동작 변경 0.

## Verification Plan

- Profile: `command`
- Required checks: 위 contract.md 의 13 checks 동일.
- Required evidence:
  - 변경 파일 diff stat
  - check 1-13 의 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary)

## Evidence To Return

- Changed files and purpose: 2~5 sub-file 생성 + entry rewrite + 각각의 책임 한 줄 설명.
- Checks run and outcomes: 13 checks 각각의 exit code + 핵심 출력 line.
- Done criteria coverage with evidence: AC-01~05 별 concrete evidence.
- Assumptions made during implementation:
  - `ConnectionDialogBody` / `Footer` / `sanitize.ts` 분리 여부 (선택, generator 재량).
  - hook return shape 의 정확한 키 이름 / 타입 (generator 재량 — 필수 의미만 노출).
  - URL parse 의 sqlite fallback chain 위치 (entry 또는 hook 안).
- Residual risk or verification gaps:
  - 2 regression test 합산 60+ 케이스가 source-of-truth — test 자체가 누락된 케이스 (예: 빠른 mode toggle race, password autofill from browser) 는 본 sprint 가 잡지 못함, 후속 candidate.
  - sprint-92 `expectNodeStable` 헬퍼는 DOM identity 만 검증, 깊은 사용자 Flow 회귀는 e2e 의존.

## References

- Contract: `docs/sprints/sprint-213/contract.md`
- Findings: `docs/sprints/sprint-213/findings.md` (작성 예정)
- Relevant files:
  - `src/components/connection/ConnectionDialog.tsx` (target, 829)
  - `src/components/connection/ConnectionDialog.test.tsx` (1362, regression guard)
  - `src/components/connection/ConnectionDialog.urlInput.test.tsx` (697, regression guard)
  - `src/components/connection/forms/{Pg,Mysql,Sqlite,Mongo,Redis}FormFields.tsx` (변경 0)
  - `src/components/connection/DialogFeedback.tsx`
  - `src/components/layout/Sidebar.tsx:16` (importer, 변경 0)
  - `src/pages/HomePage.tsx:26` (importer, 변경 0)
  - `src/components/ui/dialog.test.tsx:10` (importer, 변경 0)
  - `src/lib/connection/parseConnectionUrl.ts`, `src/lib/connection/parseSqliteFilePath.ts`
  - `src/stores/connectionStore.ts` (addConnection / updateConnection / testConnection 동결)
  - 이전 entry-pattern 참고: `src/components/document/DocumentDataGrid.tsx` (Sprint 210), `src/stores/tabStore.ts` (Sprint 212)
- 인접 sprint 문서: `docs/sprints/sprint-212/{contract,findings,handoff}.md`
- 후속 candidates: `docs/refactoring-candidates.md` §P6 (본 sprint), §P7-§P11 (잔여).
