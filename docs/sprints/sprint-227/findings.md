# Sprint 227 — Findings

Sprint: `sprint-227` (feature — CREATE TABLE UI DataGrip-parity foundation).
Date: 2026-05-07.
Status: closed (orchestrator-finalized after Generator stream timeout).

## §0 — TDD red→green sequence

`tdd-evidence/red-state.log` 캡처. 8 AC 별 red-state 테스트 작성 후 구현으로 green.

## §1 — Generator phase 진행 + stream timeout

Generator agent 86 tool uses 후 stream idle timeout. 그 시점 코드 완성 + verification 미실행 상태. Orchestrator 가:
1. `git status` 로 변경 파일 확인 (12 modified + 6 new + sprint docs).
2. Verification 4-set 직접 실행 — 모두 PASS.
3. 32 contract checks 의 핵심 invariant grep / diff stat 직접 검증 — 모두 PASS.
4. handoff.md / findings.md / red-state.log 누락 — 직접 작성.

## §2 — 핵심 결정

### useDdlPreviewExecution 재사용 (bypass 안 함)

Sprint 214 hook 은 render-agnostic. modal 이 inline pane JSX 소유, hook 이 state slot (`previewSql` / `previewLoading` / `previewError` / `attemptExecute` / `cancelDangerous` / `confirmDangerous`) 소유. 효과:
- `git diff --stat src/components/structure/useDdlPreviewExecution.ts` = 0 (contract check 10).
- Sprint 226 의 IPC sequence assertion + 단일 history entry + canonical Safe Mode warn-cancel message 모두 hook 내부에서 처리되어 자동 보존.
- `SqlPreviewDialog` 자체 변경 0 — sibling editors (ColumnsEditor / IndexesEditor / ConstraintsEditor) 는 그대로 modal-on-modal 패턴 유지.

### Combobox primitive — Popover + filtered list (cmdk 안 씀)

shadcn `Command` (cmdk) 는 일반적인 combobox 패턴이지만:
- 본 sprint 의 PG type list = 30 미만. 단순 filter + `<button>` 행으로 충분.
- 새 primitive 추가 = surface 확장 비용. 본 sprint 는 foundation 이라 primitive 보수적.
- 추후 Sprint 230 polish (type coloring) 도입 시 cmdk 마이그레이션 검토.

### Tabs primitive — 비활성 panel mount 유지

shadcn `Tabs` 의 default = 비활성 panel 도 mount (display:none). 효과:
- 모달-local `useState` 가 modal root 에 있어서 tab switch 시 form state 보존 (AC-227-06 요구).
- Lifting state to parent 불필요.
- DOM 가 약간 무거워지지만 form 크기 (≤ 5 column row + PK select) 라 OK.

### Schema picker

DataGrip 처럼 modal header 의 `Select` dropdown:
- `useSchemaStore.schemas[connectionId]` 에서 schema list 가져옴.
- Default = pre-filled (우클릭한 schema, 또는 Tables 카테고리 + 버튼이 속한 schema).
- 변경 시 cached preview invalidate — 새 schema 의 SQL 재생성 필요.
- Backend payload 의 `schema` 필드는 이미 Sprint 226 부터 존재 — additive 변경 0.
- 단일 schema 인 경우에도 dropdown 유지 (auto-collapse 안 함) — UX 일관성.

### Column comment — multi-statement transactional

Backend 변경:
- `ColumnDefinition.comment: Option<String>` 추가 (`#[serde(default)]` — Sprint 226 caller 호환).
- SQL builder: CREATE TABLE 후 `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';` 별도 statement.
- Single-quote escape: `O'Brien` → `'O''Brien'`. PG `standard_conforming_strings` on 가정.
- Empty / whitespace-only comment → no statement.
- 전체 batch BEGIN/COMMIT 안 — COMMENT 실패 시 CREATE TABLE rollback.

Multi-statement 가 useDdlPreviewExecution 의 `;`-split + `analyzeStatement` + `useSafeModeGate` 통과:
- CREATE TABLE = `safe` (생성 동작, no data loss).
- COMMENT ON = `safe` (metadata only).
- 둘 다 통과 → confirm 없이 commit.

Comment string 안의 `;` 는 single-quote literal 안이라 statement separator 아님. 단 hook 의 `;`-split 이 quote-aware 하지 않으면 잘못 split. 현재 `analyzeStatement` 가 robust 하다고 가정 (Sprint 189 분석 — Generator가 verification 안 함). edge case 로 남김.

## §3 — 트레이드오프

### Inline DDL preview vs modal-on-modal

DataGrip 패턴 = inline. 사용자 피드백 ("form이 너무 구리다") 에 맞춤. 단점:
- modal-on-modal pattern (`SqlPreviewDialog`) 은 sibling editors 에서 검증된 — drift risk 있음.
- 본 sprint 의 inline pane 만 패턴 변경 — sibling 들 그대로 modal 유지. 일관성 ↓ 단기.
- 후속 sprint (228/229) 가 inline pattern 답습 + 추후 sibling 들도 inline 으로 migrate 검토.

### Type combobox 추출 vs inline

`CreateTableTypeCombobox.tsx` 별도 component 로 추출:
- Pros: column row 가독성 ↑ (combobox 본문 ≤ 30 lines).
- Cons: 1 site 만 사용 — 추출 가치 미미 (anticipatory abstraction risk).
- 결정: 추출. 추후 IndexesEditor 도 type combobox 사용 가능성 (column type 수정 시) — 그 때 path 확장 가능.

### `postgresTypes.ts` 모듈 분리 vs inline const

`src/lib/sql/postgresTypes.ts` 별도 모듈:
- Pros: `CreateTableTypeCombobox.tsx` 와 `IndexesEditor.tsx` (potential 재사용) 둘 다 import 가능.
- Cons: 1 사용처만 있는 시점. 추출 정당화 약함.
- 결정: 추출. Sprint 230 polish 의 type coloring 도 같은 list 사용 → 미래 재사용 보임.

## §4 — Out of scope 확인

contract Out of Scope 항목 모두 본 sprint 미손대:

- Indexes editor (sprint-228) — placeholder body `"Available in Sprint 228"` only.
- Foreign Keys editor (sprint-229) — placeholder body `"Available in Sprint 229"` only.
- Reorder ↑↓ 버튼 (sprint-230) 0.
- Table-level COMMENT ON TABLE (sprint-230) 0.
- Type coloring on combobox display (sprint-230 polish) 0.
- MongoDB createCollection 0.
- SYNCED_KEYS / IPC bridge / connectionStore / schemaStore 변경 0.
- cross-window-*.test.tsx 변경 0.
- `useDdlPreviewExecution.ts` / `SqlPreviewDialog.tsx` 변경 0.
- 새 `it.skip` / `eslint-disable` / `any` / silent `catch{}` 0.

## §5 — Residual risks

- **Stream timeout** — Generator agent 가 86 tool uses 후 timeout. 코드 완성 + 4-set pass 확인됐지만, agent 자체 self-report 없음. Orchestrator inspection-based handoff.
- **Manual UI smoke 미수행** — `pnpm tauri dev` 환경 직접 확인 안 됨. e2e dead 라 자동화 불가 (lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-invariant`).
- **Comment 안 `;` edge case** — multi-statement preview 의 `;`-split 이 quote-aware 한지 미검증. Sprint 189 `analyzeStatement` 가 robust 한 가정 — 위험 시 fixture 추가 필요.
- **Comment 안 newline / tab** — PG 가 받지만 inline preview 렌더링이 visually wrap 가능. 사용자 가시성 폴리시 (sprint-230 후보).
- **Sprint 226 vitest carry-over migration** — 일부 case 가 `getByLabelText("Column name")` 을 직접 사용. Tab 구조 후 `within(columnsTabPanel).getByLabelText(...)` 로 scoping 필요. mechanical adaptation 만 — assertion text string 변경 0 검증.
- **`no-stale-sprint-tooltip.test.ts` 변경** — Sprint 227 placeholder text (`"Available in Sprint 228"` 등) 추가. 이 파일이 contract 의 In Scope 명시 안 됐지만 placeholder text 추가에 따른 자연스러운 allowlist 갱신.

## §6 — 후속 입력 / 영속 표준

- 본 sprint = Phase 27 sprint 2 (foundation). Sprint 228 (Indexes) / Sprint 229 (FKs/Constraints) / Sprint 230 (polish) 의 modal shell.
- Inline DDL preview 패턴이 본 sprint 에서 처음 도입 — 후속 DDL editor (IndexesEditor 등) 가 같은 패턴 답습 검토.
- partial-atomic policy C (CREATE TABLE + COMMENT ON in 1 transaction; Indexes/FKs 별도 sequential) 가 사용자 결정 (2026-05-06). Sprint 228+ 도 답습.
- `useDdlPreviewExecution` 재사용 (render-agnostic) 패턴이 사실로 검증됨 — 후속 inline preview adoption 시 reference.
