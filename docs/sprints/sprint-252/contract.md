# Sprint Contract: sprint-252

## Summary

- Goal: SQL/MQL Preview 표면에 (a) 클립보드 Copy 버튼과 (b) read-only
  syntax highlight 를 통일된 어포던스로 도입한다. 기존 `SqlSyntax`
  컴포넌트를 재사용해 SQL highlight 를 일관 적용하고, MQL 은 명시적
  plain fallback. CodeMirror 전면 교체는 본 sprint 범위 외 — 프로젝트는
  이미 "SqlSyntax for compact previews / CodeMirror for full editor"
  2-tier 정책 (`SqlSyntax.tsx` 의 doc comment 참조) 을 따르며, spec
  AC-252-05 의 "또는 동등한 className 신호" 단서가 SqlSyntax 마크업을
  인정한다.
- Audience: Generator + Evaluator agents (harness, /tdd 스타일).
- Owner: Sprint 252.
- Verification Profile: `command`.

## In Scope

### PreviewDialog Copy 버튼 (모든 호출자에 자동 polish)

- `src/components/ui/dialog/PreviewDialog.tsx`:
  - 신규 prop `copyText?: string`. 정의 + non-empty trim 된 값일 때만
    Copy 버튼 렌더 (그 외 버튼 자체 미렌더 — 호출자가 명시적 opt-in).
  - 신규 prop `copyAriaLabel?: string` (default `"Copy"`).
  - 위치: `DialogHeader` 내부 우측 — title/description 옆. Footer 가
    아닌 header 에 두는 이유: ① pure read-only 호출자 (footer 미렌더)
    에서도 copy 가능, ② Esc/Enter 의 confirm/cancel 흐름과 시각적 분리.
  - testid `preview-dialog-copy` 안정 노출.
  - 클릭 → `navigator.clipboard.writeText(copyText)` 호출.
    - 성공: 가시 transient 피드백 — 버튼 라벨/icon 이 ~1.5s 동안 "Copied"
      로 전환된 뒤 원복. 단순 setState + setTimeout, toast 의존 없음
      (toast 는 환경에 따라 mocking 필요 — 본 sprint 는 dialog-local
      피드백만).
    - 실패 (carrier reject 또는 미존재): 동일 위치에 "Copy failed"
      transient 피드백 (~2s) — 무음 실패 금지. 콘솔 에러 로그 1회.
  - Empty body (copyText trim → "") → 버튼 미렌더 — 호출자가 disabled
    state 를 직접 표현할 필요 없음. (AC-252-04 의 "disabled 또는 호출 시
    no-op + 사용자 피드백" 중 disabled 경로를 채택.)

### DataGrid 인라인 SQL Preview polish

- `src/components/rdb/DataGrid.tsx`:
  - 인라인 `<Dialog>` 기반 SQL Preview (현재 plain `<pre>`) 에 ① Copy
    버튼 (header 우측, `data-testid="preview-dialog-copy"` 동일 testid 로
    호출자 통일), ② 각 `<pre>` body 를 `<SqlSyntax>` 로 wrap.
  - Copy text: `editState.sqlPreview?.join(";\n").trim()` 또는 동등.
    빈 미리보기일 때 버튼 미렌더 (PreviewDialog 와 동일 정책).
  - 기존 `Enter → handleExecuteCommit`, `X → setSqlPreview(null)`,
    `commitError` 배너, environment stripe 모두 보존 — copy/highlight 는
    추가 affordance.
  - **선택**: 본 인라인 dialog 전체를 `PreviewDialog` 호출로 마이그레이션
    하지 않는다 — 기존 commit-error 배너 markup, environment stripe
    위치, X 버튼 위치, autoFocus Execute 버튼이 모두 load-bearing 이며
    PreviewDialog API 와 1:1 매핑되지 않음. Copy + highlight 만 추가.

### MqlPreviewModal — Copy 버튼 + plain fallback 명시

- `src/components/document/MqlPreviewModal.tsx`:
  - `copyText={previewLines.join("\n")}` 를 PreviewDialog 에 전달.
    `previewLines.length === 0` → trim → 빈 문자열 → 버튼 미렌더 (자동).
  - **highlight 는 plain 유지** — AC-252-07 의 "MQL-적합 강조 (또는
    plain) 로 fall back 함" 의 plain 경로 채택. SQL keyword 색이
    잘못 칠해지지 않음을 보장.
  - 기존 `<pre>` markup (`aria-label="MQL commands"`, errors 배너,
    Enter → Execute keydown) 모두 보존.

### 회귀 가드 (변경 없음, 자동 polish 만)

- `SqlPreviewDialog`: `copyText={sql}` 추가 1줄 → header 에 Copy 버튼
  자동 등장. SqlSyntax body 와 commitError 배너 markup 변경 0.
- `CellDetailDialog` / `CreateTableDialog` / `IndexesEditor` /
  `ColumnsEditor` / `ConstraintsEditor` / `ConnectionDialog` /
  `ShortcutCheatsheet`: `copyText` 미전달 → Copy 버튼 미렌더 — 기존
  visual 회귀 0.

## Out of Scope

- CodeMirror 로 SqlSyntax 전면 교체 (별도 refactor — 본 sprint 는
  Copy 버튼 + 인라인 SQL highlight 라는 사용자 가시 변경만).
- MQL syntax highlighter 도입 (Mongo dialect 강조기 자체 부재 — plain
  fallback 으로 spec AC-252-07 충족).
- Copy 동작의 toast 통합 (dialog-local transient 피드백 으로 충분).
- Per-tab vs all-tabs commit 정책 (AC-GLOBAL-06 에서 본 sprint 의 Copy
  버튼이 per-tab path 의 OK 신호임만 인정).
- Sprint 251 의 store-lift / Sprint 250 의 onBlur+Esc / Sprint 249 의
  Cmd+Z (모두 변경 0).
- DDL editor / raw query grid (별도 form state).
- IPC / safeModeStore / persistence / dialog body / commit-path 변경 0.

## Invariants

- `PreviewDialog` 기존 prop 들 (`title` / `description` / `preview` /
  `children` / `error` / `commitError` / `loading` / `confirmDisabled` /
  `onConfirm` / `onCancel` / `confirmLabel` / `cancelLabel` / `tone` /
  `className` / `confirmAriaLabel` / `headerStripe`) 시그니처 변경 0.
- 기존 호출자 8 곳 모두 `copyText` 미전달 시 byte-identical render.
- SqlPreviewDialog 의 SqlSyntax 마크업 보존 (AC-109 회귀 가드 — `text-
  syntax-keyword` span 구조).
- DataGrid 인라인 preview 의 environment stripe / X 버튼 / autoFocus
  Execute / commitError 배너 markup 보존.
- MqlPreviewModal 의 `aria-label="MQL commands"` / errors 배너 / Enter
  keydown 보존.
- AC-250-* / AC-249-U1..U9 / AC-251-S1..S5 H1..H5 T1..T3 R1..R4 /
  AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* 모두
  회귀 0.
- IPC / safeModeStore / persistence 변경 0.
- Mongo grid read-only invariant 보존.

## Acceptance Criteria

(spec 의 AC-252-01 ~ AC-252-09 그대로)

- `AC-252-01` PreviewDialog 가 `copyText` 가 non-empty trim 일 때
  `data-testid="preview-dialog-copy"` 와 명시적 `aria-label` 을 가진
  Copy 버튼을 렌더한다. Vitest 로 dialog mount → 버튼이 by role + aria-
  label 로 발견됨을 확인.
- `AC-252-02` Copy 버튼 클릭 시 본문 전체 텍스트가
  `navigator.clipboard.writeText` 로 정확히 한 번 전달된다. Vitest 로
  carrier mocking → call count 1 + arg 매칭.
- `AC-252-03` Copy 성공 시 transient 라벨 변화 ("Copied") 발생, 실패
  (carrier reject) 시 "Copy failed" 라벨 변화 발생. Vitest 로 양쪽 path
  분기 검증.
- `AC-252-04` `copyText` 가 trim 후 빈 문자열일 때 Copy 버튼 자체가
  렌더되지 않는다. Vitest 로 빈/whitespace-only body 케이스 검증.
- `AC-252-05` SqlPreviewDialog body 와 DataGrid 인라인 preview body 가
  SQL syntax highlight (SqlSyntax 의 `.text-syntax-keyword` span 또는
  동등) 마커를 포함한다. Vitest 로 SqlPreviewDialog 와 DataGrid inline
  preview 양쪽에서 keyword span 존재 확인.
- `AC-252-06` Highlight 컴포넌트는 read-only — 사용자의 키보드
  dispatch 가 본문을 변경하지 못한다. SqlSyntax 가 `<span>` only 이므로
  자명하지만 회귀 가드 테스트로 keydown dispatch 후 본문 텍스트 동일성
  단언.
- `AC-252-07` MqlPreviewModal 본문에는 SQL keyword 마커가 출현하지 않는다
  (plain fallback). Vitest 로 MQL 본문에서 `.text-syntax-keyword`
  미존재 확인.
- `AC-252-08` 모든 PreviewDialog 호출자 (`SqlPreviewDialog`,
  `MqlPreviewModal`, `CellDetailDialog`, DataGrid inline preview,
  `CreateTableDialog`, `IndexesEditor`, `ColumnsEditor`,
  `ConstraintsEditor`, `ConnectionDialog`, `ShortcutCheatsheet`) 가
  본 변경 이후에도 회귀 없이 렌더된다 — 기존 vitest suite 그대로 통과.
- `AC-252-09` Commit error / generation error / loading / 환경 stripe
  등 기존 PreviewDialog 부수 props 동작 변경 0 (회귀).

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과 (예상 ≥ 3013 — Sprint 251 baseline 3003 +
  신규 케이스 ~10).
- `it.skip` / `it.todo` / `xit` 도입 금지.
- /tdd 스타일: Generator 는 신규 테스트를 먼저 작성해 fail 을 확인한 후
  구현하고, 최종 단계에서 모든 테스트 pass 를 보고한다 (handoff 에
  "tests written first" 명시).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-252-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드
   (Rust 미변경).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.
6. `rg "preview-dialog-copy" src/` — testid 정의 + 적어도 2 호출자
   (PreviewDialog + DataGrid inline) ≥ 3 매치.
7. `rg "navigator.clipboard.writeText" src/components/ui/dialog/PreviewDialog.tsx` — carrier 호출 ≥ 1.

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌 (passing 확인).
  - `[AC-252-*]` ↔ 테스트 파일:라인 매핑 표 (9 ACs).
  - PreviewDialog 의 Copy 버튼 본문 인용 (testid + aria-label + carrier
    호출 + transient 피드백 setTimeout 정리 가드 — unmount 시 timer
    cleanup).
  - DataGrid 인라인 preview 의 SqlSyntax wrap + Copy 버튼 본문 인용.
  - MqlPreviewModal 의 `copyText` 전달 한 줄 + plain fallback 보존
    인용.
  - /tdd 흐름 증거: 신규 테스트가 먼저 작성됐음을 단 한 줄로 확인.
  - 가정 / 잔여 위험 (예: clipboard API in test env mocking 가정,
    transient timeout 정리 race, MQL plain fallback 의 사용자 가시 영향).
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - PreviewDialog 의 carrier 호출 + transient 피드백 정리 (unmount
    cleanup) verbatim.
  - 8 호출자 모두 회귀 없음 — 기존 호출자 테스트 파일이 변경 없이 통과
    했는지 spot-check.

## Test Requirements

### Unit Tests (필수, /tdd)

- `src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx` 신규
  — 5 케이스 (`AC-252-01`, `AC-252-02`, `AC-252-03` 양쪽 path,
  `AC-252-04`).
- `src/components/document/MqlPreviewModal.copy.test.tsx` 신규 또는
  기존 파일에 describe 추가 — 2 케이스 (`AC-252-07` plain fallback,
  Copy carrier 호출).
- `src/components/rdb/DataGrid.preview-copy.test.tsx` 신규 또는 기존
  파일에 describe 추가 — 2 케이스 (`AC-252-05` SQL highlight 마커
  존재, Copy 버튼 동작).
- `src/components/structure/SqlPreviewDialog.test.tsx` 회귀 가드 —
  변경 없이 통과 (Copy 버튼 추가 후에도 기존 SqlSyntax 마크업 보존).
- 기존 `dialog.test.tsx`, `MqlPreviewModal*.test.tsx`, `CellDetail
  Dialog*.test.tsx`, `CreateTableDialog.test.tsx`, `Indexes/Columns/
  ConstraintsEditor*.test.tsx` 회귀 — 변경 없이 통과.

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — SqlPreviewDialog open → Copy 클릭 → carrier 호출 +
  "Copied" 라벨 → 1.5s 후 원복.
- [x] 에러/예외 — carrier reject → "Copy failed" 라벨 → 2s 후 원복.
- [x] 경계 조건 — empty preview body → Copy 버튼 미렌더; whitespace-only
  → 미렌더; transient 피드백 도중 unmount → timer cleanup.
- [x] 회귀 없음 — 8 호출자 모두 기존 테스트 통과.

## Test Script / Repro Script

```bash
git diff --stat HEAD

# /tdd: 신규 테스트가 먼저 작성됐는지 git log 로 확인 가능
# (단일 commit 권장이므로 generator 가 명시)

# 1. 타입체크
pnpm tsc --noEmit

# 2. 린트
pnpm lint

# 3. 변경 영역 타겟 테스트 (빠른 피드백)
pnpm vitest run \
  src/components/ui/dialog/__tests__/PreviewDialog.copy.test.tsx \
  src/components/ui/dialog/__tests__/PreviewDialog.test.tsx \
  src/components/document/MqlPreviewModal.copy.test.tsx \
  src/components/rdb/DataGrid.preview-copy.test.tsx \
  src/components/structure/SqlPreviewDialog.test.tsx

# 4. 전체 회귀
pnpm vitest run

# 5. Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# 6. Wire-up grep
rg "preview-dialog-copy" src/
rg "navigator.clipboard.writeText" src/components/ui/dialog/PreviewDialog.tsx
```

## Ownership

- Generator: harness Generator agent (general-purpose), /tdd 스타일 엄수.
- Write scope: 위 In Scope 의 파일들만. Sprint 250/251 회귀 금지, DDL
  editor / raw query grid / Mongo grid 변경 금지, CodeMirror 전면 교체
  금지.
- Merge order: 단일 commit 권장 — Copy 버튼 + DataGrid inline
  highlight + 테스트는 atomic. lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- /tdd 흐름 증거 (테스트 먼저 작성됐음을 handoff 가 명시).
- Sprint 250 / 251 / 249 / 248 / 247 / 246 / 245 / ADR 0022 invariants
  보존.
