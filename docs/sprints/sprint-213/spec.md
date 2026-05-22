# Feature Spec: ConnectionDialog god-file split (Sprint 213)

## Description

`src/components/connection/ConnectionDialog.tsx` (829 lines) 가 connection dialog 의 모든 책임 — URL mode parse / form mode / host-paste detection / host:port blur split / DBMS type 변경 confirmation / password keep/clear/set 정책 / save/test dispatch / error sanitization / 전체 dialog layout — 을 단일 component scope 안에 보유한다. 11개 `useState`, 4개 핸들러 (handleTest / handleSave / handleHostPaste / handleHostBlur), 2개 mutation helper (applyDbTypeChange / handleDbTypeChange), 그리고 5-DBMS switch (renderDbmsFields) 가 한 함수 안에서 직조된다. credential policy (password keep/clear/set + ADR-0005 password masking via `sanitizeMessage`) 와 800+ 라인의 JSX layout 이 같은 scope 에 공존하므로, password leak 방어 로직 한 줄을 수정해도 unrelated form layout 까지 함께 읽어야 한다.

본 sprint 는 P6 candidate (`docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P6) 를 entry-pattern 으로 분해한다. **`useConnectionDraftForm` hook** 으로 draft mutation / DB type change confirmation flow / password resolution / trim policy 를 추출하고, **`useConnectionUrlImport` hook** 으로 URL-mode parse 와 form-mode host-paste detection 의 공통 parse pipeline 을 통합한다. (선택적으로) `ConnectionDialogBody` / `ConnectionDialogFooter` presentational component 로 layout 을 더 분해할 수 있다. **`sanitizeMessage` named export 와 default export 와 `ConnectionDialogProps` 시그니처는 동결**, 3개 importer (`Sidebar.tsx:16`, `HomePage.tsx:26`, `dialog.test.tsx:10`) 도 변경 0. 2개 regression test 파일 (1362 + 697 lines) 변경 금지. Sprint 199 (SchemaTree) / 200 (DataGridTable) / 201 (QueryTab) / 210 (DocumentDataGrid) / 211 (QuickLookPanel) 의 entry-pattern 답습.

## Sprint Breakdown

### Sprint 213: ConnectionDialog entry-pattern split

**Goal**: `ConnectionDialog.tsx` (829 lines) 를 thin entry + 2개 hook (필수) + (선택) 2개 presentational component 로 분해. entry path / default export / `sanitizeMessage` named export / `ConnectionDialogProps` 시그니처 / 3 importer 가 모두 변경 0. 행동 변경 0 — URL mode parse / form mode interaction / host-paste detection / host:port blur split / DBMS type 변경 confirm / password keep/clear/set / save/test dispatch / error sanitization 모두 사전과 동일.

**Verification Profile**: command

**Acceptance Criteria**:

1. **Entry path + public surface 보존.** `src/components/connection/ConnectionDialog.tsx` 가 사전과 동일한 위치에 존재하며 default export 는 React component (`ConnectionDialog`) 이고 props 는 `{ connection?: ConnectionConfig; onClose: () => void }` 동결. **`sanitizeMessage`** 가 entry 의 named export 로 유지 — `grep -n "export function sanitizeMessage" src/components/connection/ConnectionDialog.tsx` 매치 1건 (또는 entry 가 sub-module 에서 re-export 시 `grep -n "export.*sanitizeMessage" src/components/connection/ConnectionDialog.tsx` 매치 1건). 3 importer (`src/components/layout/Sidebar.tsx:16`, `src/pages/HomePage.tsx:26`, `src/components/ui/dialog.test.tsx:10`) 모두 import 라인 0 변경 — `grep -rn "from \"@components/connection/ConnectionDialog\"" src/ e2e/` 결과가 사전 3건과 동일.

2. **Sub-file layout 존재.** 다음 파일들이 sprint 종료 후 모두 존재하며 비어있지 않음:
   - `src/components/connection/ConnectionDialog.tsx` (entry, modify)
   - `src/components/connection/ConnectionDialog/useConnectionDraftForm.ts` (create) — draft mutation + DB type change confirmation + password resolution + trim policy 를 보유한 hook.
   - `src/components/connection/ConnectionDialog/useConnectionUrlImport.ts` (create) — URL-mode parse + form-mode host-paste detection + recognised scheme 판정 + URL-encoded SQLite path fallback 을 통합한 hook.
   - (선택, generator 재량) `src/components/connection/ConnectionDialog/ConnectionDialogBody.tsx` — Form/URL toggle / URL input / DBMS-aware field 영역 / Advanced Settings / detected affordance 를 렌더하는 presentational component.
   - (선택, generator 재량) `src/components/connection/ConnectionDialog/ConnectionDialogFooter.tsx` — Test Connection 좌측 + Cancel/Save 우측 footer + 그 위 DialogFeedback / save error alert presentational component.

   각 sub-file 은 entry (또는 다른 sub-file) 가 import 하는 적어도 하나의 export 를 가짐 — `grep -n "^export" <each-sub-file>` 매치 ≥ 1, entry 의 import 블록에 동일 identifier 가 등장.

3. **Entry shrinks meaningfully.** `wc -l src/components/connection/ConnectionDialog.tsx` 가 strictly less than **400** (사전 829 → 50%+ 감소). 두 hook 파일 합산은 **400 lines 미만**, 어느 sub-file 도 **400 lines 초과 금지** (`wc -l src/components/connection/ConnectionDialog/*.{ts,tsx}` highest row < 400).

4. **2 regression test 파일 변경 0.** `git diff --stat src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx` 모두 zero changes. 두 파일 모두 사전과 byte-identical.

5. **Project-wide regression bar.** `pnpm vitest run` exit 0 — 사전 baseline (post-Sprint-212, 189 files / 2725 tests pass) 이상 유지. `pnpm tsc --noEmit` exit 0. `pnpm lint` exit 0. 본 sprint touched 파일들에 새 `eslint-disable*` directive 0 (`git diff src/components/connection/ConnectionDialog.tsx src/components/connection/ConnectionDialog/ | grep "^+.*eslint-disable"` 매치 0). 새 silent `catch {}` 0 (`git diff` 의 추가 라인에서 `} catch (\\w+) \\{$` 직후 `}` 만 있는 패턴 0건 — 기존 `sanitizeMessage` 로 라우팅되는 `catch` 블록은 유지).

**Components to Create/Modify**:

- `src/components/connection/ConnectionDialog.tsx` (modify, entry):
  Thin orchestration component. `useConnectionDraftForm` 과 `useConnectionUrlImport` 를 호출해 form / URL state 를 받아오고, 받은 handler 를 layout 에 전달. 자체적으로 보유하는 state 는 dialog-local UX state (`testResult` / `saving` / `error`) 에 한정. JSX 는 (a) 직접 렌더하거나 (b) `ConnectionDialogBody` + `ConnectionDialogFooter` 에 위임. `sanitizeMessage` 는 entry 의 named export 로 유지하거나, 별도 helper 모듈 (`src/components/connection/ConnectionDialog/sanitize.ts`) 로 옮기되 entry 가 re-export 하는 방식 모두 허용. `assertNever` 를 통한 5-DBMS exhaustive switch (`renderDbmsFields`) 는 entry 또는 body 둘 중 한 곳에 잔존.

- `src/components/connection/ConnectionDialog/useConnectionDraftForm.ts` (create):
  Draft form state machine hook. 입력: `connection?: ConnectionConfig`. 출력: `{ form, setForm, passwordInput, setPasswordInput, clearPassword, setClearPassword, isEditing, hadPassword, isSqlite, pendingDbTypeChange, handleDbTypeChange, handleConfirmDbTypeReplace, handleCancelDbTypeReplace, resolvePassword, trimDraft, applyParsedConnection }` (정확한 shape 은 generator 재량, 단 필수 의미를 모두 노출). 책임:
  - `useState<ConnectionDraft>` 초기화 (`connection ? draftFromConnection(connection) : createEmptyDraft()`).
  - `passwordInput` / `clearPassword` state 보유.
  - `applyDbTypeChange` (defaults 적용 — `port`, `user`, `database`, `paradigm`, host/name/group_id/color/environment 보존).
  - `handleDbTypeChange` (default-or-empty port → silent apply; 그 외 → `pendingDbTypeChange` set).
  - `handleConfirmDbTypeReplace` / `handleCancelDbTypeReplace`.
  - `resolvePassword` (new = passwordInput; editing+clearPassword = ""; editing+input = passwordInput; editing+empty = null).
  - `trimDraft` (name / host / database / user trim, password 제외).
  - `applyParsedConnection(parsed: ConnectionDraft, password?: string | null)` — URL parse 결과를 form 에 머지하고 (name 빈 경우 database 차용), password 가 있으면 `setPasswordInput`. URL mode `Parse & Continue` 와 form mode host-paste 가 공통으로 사용.
  - `pendingDbTypeChange` state 자체가 hook 외부에서 ConfirmDialog 렌더링 결정 input 으로 노출.

- `src/components/connection/ConnectionDialog/useConnectionUrlImport.ts` (create):
  URL parse + paste detection hook. 입력: 최소 `applyParsedConnection` (또는 동일 의미의 `setForm` + `setPasswordInput` + 현재 form), `dbType` (sqlite fallback 판정용). 출력: `{ urlValue, setUrlValue, urlError, setUrlError, parseAndApply, handleHostPaste, handleHostBlur, detectedScheme, setDetectedScheme }` (또는 동등 의미의 shape). 책임:
  - `urlValue` / `urlError` / `detectedScheme` state.
  - `RECOGNISED_SCHEMES = ["postgres", "postgresql", "mysql", "mariadb", "mongodb", "mongodb+srv", "redis", "sqlite"]` 보유.
  - `looksLikeRecognisedUrl(text)` (사전 동일 정의: `${scheme}://` prefix + sqlite single slash 변형).
  - `parseAndApply(text)` — URL-mode `Parse & Continue` 의 fallback chain (`parseConnectionUrl(urlValue) ?? (form.db_type === "sqlite" ? parseSqliteFilePath(urlValue) : null)`) + 실패 시 `urlError` set + 성공 시 `applyParsedConnection`. `inputMode` 전환 (form 으로 돌아가기) 의 호출 책임은 entry 에 잔존 (hook 은 form/URL mode 자체 모름).
  - `handleHostPaste(e)` — `target.id !== "conn-host"` short-circuit + `looksLikeRecognisedUrl` 검사 + `parseConnectionUrl` 호출 + 성공 시 `e.preventDefault()` + `applyParsedConnection` + `setDetectedScheme`. malformed 시 silent (AC-178-04).
  - `handleHostBlur(e)` — `target.id !== "conn-host"` short-circuit + `HOST_PORT_RE = /^([^[:][^:]*):(\d+)$/` 매치 + `setForm(host, port)` (entry/draft hook 의 setter 사용).

- `src/components/connection/ConnectionDialog/ConnectionDialogBody.tsx` (create, **선택적 — generator 재량**):
  Presentational form area. props 로 `inputMode` / `setInputMode` / `urlValue` / `setUrlValue` / `urlError` / `parseAndApply` / `form` / `setForm` / `pendingDbTypeChange` / `handleDbTypeChange` / `handleHostPaste` / `handleHostBlur` / `detectedScheme` / DBMS-aware shared auth (`passwordInput` / `setPasswordInput` / `isEditing` / `hadPassword` / `clearPassword` / `setClearPassword`) / `inputClass` / `labelClass` / `isEditing` 받음. JSX:
  - Form/URL ToggleGroup (new connection 만).
  - URL input section + Parse & Continue button (URL mode).
  - Form mode 전체: Name / Database Type Select / Environment Select / DBMS-aware fields (5-switch) / detected affordance / Advanced Settings details.
  - 행동 변경 0 — placeholder, autoFocus, label, classNames, onChange dispatch 모두 사전 동일.

- `src/components/connection/ConnectionDialog/ConnectionDialogFooter.tsx` (create, **선택적 — generator 재량**):
  Presentational alert + footer. props: `feedbackState` / `feedbackMessage` / `error` / `testing` / `saving` / `isEditing` / `onTest` / `onCancel` / `onSave`. JSX:
  - `<DialogFeedback slotName="test-feedback" .../>` (sprint-92 selector 보존, sprint-95 layer-1 mapping 그대로).
  - `error && <div role="alert" .../>` save error alert (border-t border-border bg-destructive/10 등 className 사전 동일).
  - Footer: justify-between, 좌측 Test Connection (variant=ghost, Loader2/Plug + label, disabled=testing), 우측 Cancel/Save (Update 라벨 isEditing 시).

- `src/components/connection/ConnectionDialog/sanitize.ts` (**선택적 — generator 재량**):
  `sanitizeMessage` 함수 본체를 호스팅. entry 가 `export { sanitizeMessage } from "./ConnectionDialog/sanitize"` 로 re-export 하면 named export 보존. 본문 변경 금지 — replaceAll + URL-encoded variant 마스킹 정확히 사전 동일.

## Global Acceptance Criteria

1. **행동 변경 0.** 사용자 관찰 가능한 모든 흐름이 사전과 동일:
   - **New connection (form mode)**: Name 입력 → Database Type 선택 (Pg/MySQL/SQLite/Mongo/Redis) → 각 DBMS 별 fields 렌더 → Save → `addConnection(trimmed)` + `window.dispatchEvent(new Event("connection-added"))` + `onClose`.
   - **New connection (URL mode)**: ToggleGroup URL 클릭 → Connection URL input + placeholder + 도움 텍스트 → Parse & Continue 클릭 → `parseConnectionUrl(urlValue) ?? parseSqliteFilePath(urlValue)` (sqlite 선택 시) → 성공 시 form 머지 + name 빈 경우 database 차용 + password input 채움 + form mode 로 전환. 실패 시 `role="alert"` 으로 "Invalid URL ..." 메시지.
   - **Edit connection**: Form 사전 채움 → Update 버튼 → `updateConnection(trimmed)` → `onClose`. URL mode toggle 미렌더.
   - **Password keep/clear/set 의미**:
     - 신규: input 그대로 password 로 송신 (빈 string 가능).
     - 편집 + 빈 input + clearPassword 미체크: `password: null` (keep existing).
     - 편집 + 빈 input + clearPassword 체크: `password: ""` (clear).
     - 편집 + 새 password 입력: `password: input value`.
     - clearPassword 체크 시 password input 자체 disabled + 값 비움.
   - **Test Connection**: 4-state DialogFeedback (idle / loading / success / error), `data-slot="test-feedback"` DOM identity 보존 (sprint-92 contract). pending 동안 disabled + Loader2. error 메시지는 `sanitizeMessage(...)` 적용 후 표시.
   - **DBMS type 변경**: current port = default-or-0 → silent apply (host/name/group_id/color/environment 보존, port/user/database/paradigm 갱신). 그 외 → ConfirmDialog (title="Replace custom port?" / 메시지 / confirmLabel="Use default port {N}"). Confirm → apply + close. Cancel → 양쪽 모두 unchanged + close.
   - **Host paste detection (form mode)**: 8 recognised scheme (postgres/postgresql/mysql/mariadb/mongodb/mongodb+srv/redis/sqlite) URL paste → form 1-step populate + non-modal "Detected ... URL — fields populated." affordance (`data-testid="connection-url-detected"`, role 없음). 빈 paste / malformed paste / 미인식 prefix → silent no-op.
   - **Host:port blur split**: `host:digits` 단일 매치 시 split. bracketed IPv6 (`[::1]:5432`), 다중 콜론 IPv6 (`fe80::1`), 비-digit suffix (`db:abcd`) 모두 unchanged.
   - **SQLite mode**: Database file 입력만 노출 — Host/Port/User/Password 미렌더. SQLite save 시 `database` (file path) 만 trim 정책 따로 적용 안 함 (`parseSqliteFilePath` 가 parse 시 trim). `database` 빈 경우 "Database file is required" 에러.
   - **Save validation**: trimmed name 빈 경우 "Name is required". 비-SQLite 의 trimmed host 빈 경우 "Host is required". SQLite 의 trimmed database 빈 경우 "Database file is required".
   - **Error sanitization**: `sanitizeMessage(String(e), passwordInput, form.password)` 가 raw + URL-encoded 두 변형 모두 마스킹. test-feedback aria-live region + save-error `role="alert"` region 모두 password 미포함.
   - **Escape / Cancel / X**: 모두 `onClose()` 호출.
   - **Environment select**: None / Local / Testing / Development / Staging / Production 6 옵션. ENV_NONE_SENTINEL = "__none__" → null 매핑 그대로.

2. **Public import path 동결.** 외부 코드 (`Sidebar.tsx`, `HomePage.tsx`, `dialog.test.tsx`) 는 `@components/connection/ConnectionDialog` 만 import. sub-file 은 entry 내부 — `grep -rn "from \"@components/connection/ConnectionDialog/" src/ e2e/` 매치 0 (entry 자기 import 제외). DBMS-specific field components (`forms/PgFormFields` / `MysqlFormFields` / `SqliteFormFields` / `MongoFormFields` / `RedisFormFields`) 의 import path / signature / props 0 변경.

3. **`sanitizeMessage` 본문 동결 + named export 보존.** `sanitizeMessage` 함수 본체 (replaceAll-based plaintext + URL-encoded variant 마스킹, empty/whitespace short-circuit) 는 변경 0. entry 또는 sub-module 어디에 위치하든 `import { sanitizeMessage } from "@components/connection/ConnectionDialog"` 는 사전과 동일하게 작동. 사전 사용 site (해당 모듈 내부 2곳: `handleTest` / `handleSave` catch 블록) 도 동일 의미 유지.

4. **Connection store API 동결.** `useConnectionStore` 의 `addConnection` / `updateConnection` / `testConnection` selector subscription 은 entry 또는 hook 안에서 사전과 동일한 selector 패턴으로 호출. store API 변경 0. `testConnection(draft, connection?.id ?? null)` 의 두 번째 arg 시그니처 (existingId) 보존.

5. **Accessibility roles + ARIA 보존.**
   - Dialog: `role="dialog"`, `aria-labelledby="dialog-title"`, w-dialog-sm width token.
   - Header: title id="dialog-title", description sr-only.
   - Close button: `aria-label="Close dialog"`.
   - Database Type select: `aria-label="Database Type"`.
   - Environment select: `aria-label="Environment"`.
   - Test feedback: `data-slot="test-feedback"` 항상 마운트, idle 상태에서도 placeholder 마운트 (sprint-95 `<DialogFeedback>` `dialog-feedback-idle` testid). pending 상태에서 spinner + "Testing..." 텍스트가 슬롯 안에 렌더.
   - Save error: `role="alert"` (조건부, error state set 시).
   - URL parse error: `role="alert"`.
   - Validation error: `role="alert"`.
   - DBMS Confirm dialog: `role="alertdialog"` + 사전 동일 title / message / confirmLabel / Cancel button text.
   - Detected affordance: NO `role="alert"` / `role="status"` / `aria-live` (AC-178-04 silence + AC-178-05 leak guard).

6. **DBMS-specific field components 동결.** `forms/PgFormFields` / `MysqlFormFields` / `SqliteFormFields` / `MongoFormFields` / `RedisFormFields` 의 props (`draft` / `onChange` / shared auth 묶음 / `inputClass` / `labelClass`) 시그니처 변경 0. `assertNever` exhaustive switch 동작 유지.

7. **신규 unit test 0.** 본 sprint 는 refactor-only — 새 `*.test.ts(x)` 파일 생성 0, 기존 두 regression test 파일 (`ConnectionDialog.test.tsx` 1362 lines + `ConnectionDialog.urlInput.test.tsx` 697 lines) 변경 0. test 파일 수 (`find src/components/connection -name "*.test.tsx" | wc -l`) 사전과 동일.

8. **Lint / TypeScript / build 모두 exit 0.**
   - `pnpm lint` exit 0 — 새 `eslint-disable*` directive 0 (`git diff` touched 파일의 `^+.*eslint-disable` 매치 0).
   - `pnpm tsc --noEmit` exit 0 — `ConnectionDraft` / `DatabaseType` / `ConnectionConfig` / `DialogFeedbackState` 타입 사용 사전 동일, hook return shape 의 타입은 strict mode 통과.
   - `pnpm vitest run` exit 0 — sprint-212 baseline (189 files / 2725 tests pass) 과 동일 또는 신규 hook 파일 추가에 따라 file 카운트 ±1-2 허용 (단 fail 0).
   - 새 silent `catch {}` 0 — 사전 `sanitizeMessage` 가 호출되는 catch 블록 (handleTest / handleSave 2곳) 은 그대로 유지하고 추가되는 catch 도 sanitize 또는 명시적 처리 유지.

9. **Diff sanity + 분해 충실도.**
   - `git diff --stat src/components/connection/ConnectionDialog.tsx` 의 net `-` 라인 수가 net `+` 라인 수보다 큼 (entry 가 작아짐).
   - 새 sub-file 합산 라인 수 (entry + 두 hook + 선택적 body/footer) ≤ 사전 entry (829) + 50 (서명/경계 boilerplate 허용 buffer).
   - 모든 sub-file 이 적어도 한 곳에서 import 됨 (orphan 0, `grep -rn` 검사).

## Data Flow

### Before (current state)

**Draft mutation chain:**
- User input (Name / Host / Port / User / Database / etc.) → `setForm(f => ({ ...f, [field]: value }))` 로 inline lambda → `form` state.
- DBMS Type 변경 → `handleDbTypeChange(newDbType)` → port 정책 분기 → silent path (`applyDbTypeChange`) 또는 `setPendingDbTypeChange({ to })`.
- Confirm → `handleConfirmDbTypeReplace` → `applyDbTypeChange` + `setPendingDbTypeChange(null)`.
- Cancel → `handleCancelDbTypeReplace` → `setPendingDbTypeChange(null)`.

**URL parse chain (URL mode):**
- `Parse & Continue` 클릭 → inline lambda → `parseConnectionUrl(urlValue) ?? (form.db_type === "sqlite" ? parseSqliteFilePath(urlValue) : null)` → 실패 시 `setUrlError("Invalid URL ...")` + 성공 시 `setForm({...rest, name: f.name || database || ""})` + `setPasswordInput(password)` + `setInputMode("form")`.

**Host paste chain (form mode):**
- onPaste on form wrapper → `handleHostPaste(e)` → `target.id !== "conn-host"` 검사 → `looksLikeRecognisedUrl` → `parseConnectionUrl` → 성공 시 `e.preventDefault()` + `setForm({...rest, name: f.name || database || f.name})` + `setPasswordInput(password)` + `setDetectedScheme(parsed.db_type ?? null)`. malformed 시 silent.

**Host blur chain (form mode):**
- onBlur on form wrapper → `handleHostBlur(e)` → `target.id !== "conn-host"` 검사 → `HOST_PORT_RE.test(value)` → match 시 `setForm({ host, port })`.

**Save / Test dispatch chain:**
- `handleTest` → `setTestResult({ status: "pending" })` → `trimDraft({...form, password: resolvePassword()})` → `testConnection(draft, connection?.id ?? null)` → 성공 시 success / 실패 시 error + `sanitizeMessage`.
- `handleSave` → `trimDraft(...)` → validation (name/host/database) → `addConnection` 또는 `updateConnection` → 성공 시 `onClose` + (new) `dispatchEvent("connection-added")` / 실패 시 `setError(sanitizeMessage(...))`.

### After (this sprint)

**Draft mutation chain (via `useConnectionDraftForm`):**
- Hook returns `{ form, setForm, applyParsedConnection, handleDbTypeChange, handleConfirmDbTypeReplace, handleCancelDbTypeReplace, pendingDbTypeChange, resolvePassword, trimDraft, passwordInput, setPasswordInput, clearPassword, setClearPassword, isEditing, hadPassword, isSqlite }` (정확한 shape generator 재량).
- DBMS Type Select → `handleDbTypeChange` 호출 → 내부에서 동일 분기 → silent apply 또는 `pendingDbTypeChange` set. 외부에서 보이는 의미 동일.
- Confirm/Cancel → hook 의 `handleConfirmDbTypeReplace` / `handleCancelDbTypeReplace` 호출. ConfirmDialog 자체의 마운트 결정은 entry 에서 `pendingDbTypeChange` 값 검사로 수행.

**URL parse / paste detection chain (via `useConnectionUrlImport`):**
- Hook returns `{ urlValue, setUrlValue, urlError, setUrlError, parseAndApply, handleHostPaste, handleHostBlur, detectedScheme, setDetectedScheme }`.
- Hook 내부에서 `applyParsedConnection` (draftForm hook 에서 받음) 을 호출해 form 머지.
- URL-mode `Parse & Continue` 클릭 → entry 가 `parseAndApply(urlValue)` 호출 → 성공 시 hook 내부에서 form 머지 → entry 가 `setInputMode("form")` 호출 (mode 자체는 entry-local state).
- form-mode onPaste / onBlur → entry 가 hook 의 `handleHostPaste` / `handleHostBlur` 를 form wrapper 에 전달 → hook 내부에서 conn-host 검사 + parse + 머지.

**Save / Test dispatch chain:**
- entry-local `testResult` / `saving` / `error` state 보존.
- entry 의 `handleTest` / `handleSave` 가 hook 의 `trimDraft` / `resolvePassword` 호출. `sanitizeMessage(String(e), passwordInput, form.password)` 그대로 적용. 모든 dispatch 의미 동일.

### Cross-module dependency

```
ConnectionDialog.tsx (entry)
  ├─→ useConnectionDraftForm  (form / draft / DB type confirm / password / trim)
  ├─→ useConnectionUrlImport  (URL parse / paste detection / blur split)
  │     ├─→ uses applyParsedConnection from useConnectionDraftForm
  │     └─→ uses dbType from useConnectionDraftForm (sqlite fallback)
  ├─→ ConnectionDialogBody    (선택적 — form / URL toggle / fields / Advanced)
  ├─→ ConnectionDialogFooter  (선택적 — DialogFeedback / error / Test/Cancel/Save)
  └─→ sanitizeMessage         (entry 또는 sanitize.ts; entry re-export 의무)

ConnectionDialog → forms/{Pg,Mysql,Sqlite,Mongo,Redis}FormFields (변경 0)
ConnectionDialog → @stores/connectionStore (addConnection / updateConnection / testConnection — 동결)
```

## UI States

본 sprint 는 refactor-only — 사용자 관찰 가능 상태 사전 동일. 핵심 상태 enumerate:

- **Initial render (new)**: Header "New Connection" / ToggleGroup (Form 활성) / Name 빈 (autoFocus) / Database Type=PostgreSQL (port=5432, user=postgres) / Environment=None / DBMS-specific fields (Host=localhost / Port=5432 / User=postgres / Database 빈, password 빈) / Advanced Settings 접힘 / Test feedback idle (placeholder 마운트) / Footer = Test Connection / Cancel / Save.

- **Initial render (edit)**: Header "Edit Connection" / ToggleGroup 미표시 / Name pre-filled / Database Type 사전 값 / Password 빈 + placeholder "Leave blank to keep current password" + "Password set" / "No password" 배지 / Update 버튼.

- **URL mode (new connection)**: Connection URL input (autoFocus) + placeholder "postgresql://user:password@host:5432/database" + 도움 텍스트 + Parse & Continue 버튼.

- **DBMS Confirm dialog**: `role="alertdialog"` mount, title="Replace custom port?", message="Switching from {old} to {new} will reset port {N} → {M}. Continue?", confirmLabel="Use default port {M}", Cancel.

- **Test loading**: feedback slot 안 spinner + "Testing..." (`data-slot="test-feedback"` DOM identity 사전 동일 — `expectNodeStable` 추적).

- **Test success**: feedback slot 안 success message ("Connection successful" 등). aria-live="polite".

- **Test error**: feedback slot 안 "Error: ..." 메시지 (sanitizeMessage 적용 결과).

- **Save loading**: Save 버튼 disabled + 텍스트 "Saving...".

- **Save error**: footer 위 `role="alert"` border-t border-destructive bg-destructive/10 region. `sanitizeMessage` 적용. animate-in fade-in slide-in-from-top-1 그대로.

- **Validation error (Name/Host/Database)**: 동일 `role="alert"` region 에 메시지.

- **Form mode + paste detect (success)**: detected affordance 표시 — "Detected {scheme} URL — fields populated." (text-2xs text-muted-foreground, role 없음).

- **Form mode + paste detect (malformed)**: silent no-op (host 변경 없음, affordance 미표시).

- **Form mode + host blur split**: `localhost:5433` → host="localhost", port=5433.

## Edge Cases

- **host:port paste split (split 됨)**: `localhost:5433` → host="localhost", port=5433.
- **host:port paste split (split 안 됨)**: `[::1]:5432` (bracketed IPv6), `fe80::1` (다중 콜론), `db.example.com:abcd` (비-digit) — 모두 host 그대로, port unchanged.
- **DBMS-specific default port replace confirm**: PG default 5432 → MySQL silent apply (3306). 사용자가 PG port=15432 로 변경한 후 → MySQL 선택 시 ConfirmDialog 마운트. Cancel 시 dbType=postgres + port=15432 유지.
- **password keep semantics**:
  - 편집 + 빈 input + clearPassword 미체크 → `password: null` (backend keep).
  - 편집 + 빈 input + clearPassword 체크 → `password: ""` (backend clear).
  - 편집 + new password 입력 → `password: input value`.
  - 편집 + clearPassword 체크 후 input 에 입력 → input 자체 disabled, 값 비움.
- **SQLite file path**:
  - URL mode 에서 SQLite 가 선택된 상태로 절대 경로 (`/data/app.sqlite`) 입력 → `parseSqliteFilePath` fallback → `database` 에 경로 landing.
  - host paste 에서 `sqlite:/path` paste → `parseConnectionUrl` 가 sqlite scheme 처리 → `db_type = "sqlite"` + database = path 머지 + Host/Port/User/Password 필드 사라지고 Database file 필드 표시.
  - SQLite 의 `database` 빈 경우 save 시 "Database file is required".
- **URL parse failure**:
  - URL mode `Parse & Continue` 실패 시 `role="alert"` "Invalid URL ..." 메시지 + form mode 전환 안 함.
  - form mode host paste 실패 시 silent (no alert / no toast / no state change). 사용자 paste 텍스트는 default browser paste behaviour 로 host 필드에 잔존.
- **trim policy 경계**:
  - `name = "  My DB  "` → save 시 `"My DB"`.
  - `password = "  secret  "` → save 시 `"  secret  "` (verbatim, ADR-0005).
  - whitespace-only name → "Name is required".
- **DBMS type swap 후 password 정책**: PG 편집 → MySQL 변경 시 → password 입력은 변경 0 (host preserved 와 동일 logic; user/database/port 만 reset).
- **Concurrent test clicks**: 3회 빠른 Test Connection 클릭 → DialogFeedback slot DOM identity 그대로 (sprint-92 contract). 마지막 클릭의 result 가 슬롯에 표시.
- **Environment 변경 후 save**: `environment` 가 `null` (None) 또는 enum value 로 draft 에 포함되어 송신.

## Verification Hints

- **Primary regression command**: `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx` exit 0. 두 파일 합산 ~ 60+ 테스트 모두 통과.

- **File-shape checks**:
  - `wc -l src/components/connection/ConnectionDialog.tsx` < 400.
  - `ls src/components/connection/ConnectionDialog/` 가 (필수) `useConnectionDraftForm.ts` + `useConnectionUrlImport.ts` 포함; (선택) `ConnectionDialogBody.tsx` / `ConnectionDialogFooter.tsx` / `sanitize.ts` 추가 가능.
  - `wc -l src/components/connection/ConnectionDialog/*.{ts,tsx}` 의 highest row < 400.

- **Public-surface checks**:
  - `grep -rn "from \"@components/connection/ConnectionDialog\"" src/ e2e/` 매치 = 사전 3건 (`Sidebar.tsx:16`, `HomePage.tsx:26`, `dialog.test.tsx:10`).
  - `grep -rn "from \"@components/connection/ConnectionDialog/" src/ e2e/` 매치 0 (sub-file 은 entry 내부, 외부 직접 import 금지).
  - `grep -n "export function sanitizeMessage\|export.*sanitizeMessage" src/components/connection/ConnectionDialog.tsx` 매치 ≥ 1.
  - `grep -n "export default function ConnectionDialog\|export default" src/components/connection/ConnectionDialog.tsx` 매치 ≥ 1.

- **Behavior contract checks (regression test 통과로 자동 검증)**:
  - sprint-92 sprite-feedback DOM identity (`expectNodeStable` 헬퍼 호출 4건 통과).
  - sprint-95 `<DialogFeedback slotName="test-feedback" .../>` 매핑 그대로.
  - sprint-108 DBMS port confirm flow.
  - sprint-138 5-DBMS form shape.
  - sprint-178 trim / paste detect / blur split / silent malformed / password leak 5 그룹.

- **Project-wide gates**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.

- **Test file 동결 검증**: `git diff --stat src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx` 양쪽 모두 0 changes.

- **Connection store API 동결**: `grep -n "addConnection\|updateConnection\|testConnection" src/stores/connectionStore.ts` 의 export 시그니처 사전과 동일 (변경 0). `grep -rn "testConnection.*connection?.id" src/components/connection/` 가 entry 또는 useConnectionDraftForm/useConnectionUrlImport 안에 1건 매치.

- **새 eslint-disable / silent catch 0**:
  - `git diff src/components/connection/ConnectionDialog.tsx src/components/connection/ConnectionDialog/ | grep "^+.*eslint-disable"` 0 라인.
  - `git diff` 추가 라인 안에 `} catch (\\w+) \\{$` 직후 닫는 `}` 만 있는 빈 catch 0건. 사전 `catch (e) { setTestResult({ status: "error", message: sanitizeMessage(...) }) }` / `catch (e) { setError(sanitizeMessage(...)) }` 패턴은 sanitize 호출이 본문에 있으므로 silent 가 아님.

- **Diff sanity**:
  - `git diff --stat src/components/connection/ConnectionDialog.tsx` 의 net `-` 라인 수 > net `+` 라인 수.
  - `git diff --stat src/components/connection/ConnectionDialog/` 의 새 파일 합산 ≤ 사전 entry 829 - 새 entry 라인 수 + 50 buffer.

- **Importer drift 0**: `git diff --stat src/components/layout/Sidebar.tsx src/pages/HomePage.tsx src/components/ui/dialog.test.tsx` 모두 0 changes (3 importer 동결).

### Critical Files for Implementation

- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionDialog.tsx
- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionDialog/useConnectionDraftForm.ts
- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionDialog/useConnectionUrlImport.ts
- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionDialog.test.tsx
- /Users/felix/Desktop/study/view-table/src/components/connection/ConnectionDialog.urlInput.test.tsx
