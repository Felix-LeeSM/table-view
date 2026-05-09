# Sprint 256 Contract

> Reference: master spec `docs/sprints/sprint-253/spec.md` §Sprint 256.
> Reference: ADR 0023 / grill Q4-(c) + Q5-(b) + Q6-(a).

## Scope

영구 환경 chrome (top stripe + prod-only window border) + 모든 Execute
버튼의 color × target 라벨 + ConfirmDestructiveDialog 헤더 env token
정렬. ADR 0023 의 *영구 환경 chrome* (사용자 발화 "production인데
수정하겠냐 같은 색 담은 메시지가 낫지") 의 시각 polish 통합.

Acceptance criteria 매핑: AC-256-01 / AC-256-02 / AC-256-03 / AC-256-04 /
AC-256-05 / AC-256-06 / AC-256-07.

## Done Criteria (완료 기준)

1. **`useActiveTabConnection` hook 신설**:
   `src/hooks/useActiveTabConnection.ts` — `useTabStore.activeTabId` + `useConnectionStore.connections` 결합 → 현재 활성 탭의 connection 반환 (`Connection | null`). 활성 탭 없거나 connection 미존재 시 `null`. 단위 테스트 (활성 탭 변경 시 갱신, connection 삭제 시 null fallback).

2. **`EnvironmentChromeStripe` 컴포넌트 신설** (AC-256-01):
   `src/components/layout/EnvironmentChromeStripe.tsx` — `useActiveTabConnection` 으로 활성 탭 connection 의 environment 추적. staging 환경이면 `--tv-env-staging` 배경 + `--tv-env-staging-text` 텍스트 + `STAGING · <conn> · <host>`. production 이면 `--tv-env-prod` 배경 + `--tv-env-prod-text` 텍스트 + `PRODUCTION · <conn> · <host>` + 펄스 dot 2개. dev/local/testing/development/null → 미렌더 (`return null`). 높이 ≈ 24px, full-width, App shell 최상단. `data-environment-stripe` attribute 로 테스트 식별.

3. **App shell mount + prod window border** (AC-256-02):
   `src/App.tsx` 의 `<div className="flex h-screen w-screen overflow-hidden bg-background">` 외부에 `<EnvironmentChromeStripe />` mount + 활성 탭이 production 일 때 outer wrapper 에 1px `--tv-env-prod` border (CSS class `chrome-prod-border` 또는 inline style). 비-prod 활성 시 border 미표시. macOS Tauri WKWebView 검증.

4. **활성 탭 즉시 갱신** (AC-256-03):
   `useActiveTabConnection` 의 selector 가 store 변경 시 즉시 재구독 → React 의 정상 re-render flow 로 stripe + border 한 frame 안에 갱신. 단위 테스트 (활성 탭 dev → prod 전환 시 stripe + border 등장 / 반대로 dev 로 → 둘 다 사라짐).

5. **`prefers-reduced-motion` 펄스 dot skip** (AC-256-04):
   CSS `@media (prefers-reduced-motion: reduce)` 또는 `useReducedMotion` hook 으로 `EnvironmentChromeStripe` 의 펄스 dot 애니메이션 skip. static stripe 만 유지. 단위 테스트 (mock matchMedia → animation class 미적용).

6. **`ExecuteButton` 컴포넌트 신설** (AC-256-05):
   `src/components/ui/ExecuteButton.tsx` — composed button with:
   - 라벨: `Execute` (env null/dev — local/testing/development) 또는 `Execute on <conn>` (env staging/production). 폭 ≥ 0 + `max-w-[260px]` truncate + `title={fullLabel}` tooltip.
   - 색: severity × env matrix:
     - WARN + dev (or null) → `--tv-success` (green)
     - WARN + staging → `--tv-warning` (orange, 새 deep `#ea580c`)
     - WARN + prod → `--tv-destructive` (red)
     - STOP (any env) → `--tv-destructive`
   - icon: `Play` (default) / `Loader2 animate-spin` (loading)
   - props: `severity: "warn" | "danger"`, `environment: string | null`, `connectionLabel: string | null`, `loading: boolean`, `disabled: boolean`, `onClick: () => void`, `ariaLabel?: string`.
   - 단위 테스트 (4 severity×env 조합 + loading + disabled + tooltip).

7. **5 surfaces 의 Execute 버튼 교체** (AC-256-05 cont'd):
   - `src/components/structure/SqlPreviewDialog.tsx` (PreviewDialog confirmLabel)
   - `src/components/document/MqlPreviewModal.tsx` (PreviewDialog confirmLabel)
   - `src/components/rdb/DataGrid.tsx` (인라인 preview footer)
   - `src/components/query/EditableQueryResultGrid.tsx` (toolbar Execute)
   - `src/components/workspace/ConfirmDestructiveDialog.tsx` (footer Execute)
   각 surface 에 connection (env + label) 를 prop 또는 store hook 으로 전달. SqlPreviewDialog / MqlPreviewModal / ConfirmDestructiveDialog 의 props 시그니처는 가능한 한 보존 (env / connectionLabel 만 추가).

8. **ConfirmDestructiveDialog 헤더 env token 정렬** (AC-256-06):
   현재 hard-coded 배경/텍스트 → `--tv-env-prod` / `--tv-env-prod-text` 토큰 사용. "PRODUCTION DATABASE" 헤더 배경/텍스트 가 chrome top stripe 와 동일 token 으로 시각 일관. 비-prod 헤더는 회귀 0.

9. **Sprint 252 / 251 / 250 / 249 polish 회귀 0** (AC-256-07):
   Copy 버튼 / SqlSyntax / store-lift / onBlur+Esc / Cmd+Z 모두 보존. PreviewDialog / SqlPreviewDialog 의 markup / props 시그니처 byte-for-byte 보존 (confirmLabel slot 만 변경).

10. **AC-256-01..07 모두 매핑**.

11. **/tdd 흐름**:
    - 신규 테스트 먼저 (`useActiveTabConnection.test.tsx`, `EnvironmentChromeStripe.test.tsx`, `ExecuteButton.test.tsx`, `ConfirmDestructiveDialog.tsx` env token 회귀, 5 surfaces 의 Execute 라벨 회귀), fail (red).
    - 구현 → green.
    - 기존 회귀 테스트 (Sprint 245-255 의 모든 AC) 모두 pass.

12. **Verification Plan** 7개 check 모두 pass.

## Out of Scope

- Per-theme syntax palette curation — Sprint 257.
- Severity classifier 4-tier 확장 — 본 sprint 비대상 (3-tier 그대로).
- WARN dialog mount 변경 — Sprint 255 동작 보존.
- TabBar polish — Sprint 253 보존.
- 6 env tokens / `--tv-warning` 값 변경 — Sprint 253 보존.
- IPC 시그니처 변경 — `executeQuery`, `executeQueryDryRun`, `aggregateDocuments`, `findDocuments`, `cancelQuery`.
- safeModeStore / connectionStore / tabStore / queryHistoryStore 액션·상태 변경.
- 신규 ADR 작성 — ADR 0023 가 본 sprint 의 결정 묶음.
- Audit-log 인프라 / read-only flag / per-tab override (Q8/Q9 거부).
- 5-tier env enum migration — 5-tag 보존 결정 (Q1).

## Invariants

- ADR 0022 Phase 1-5 / Sprint 250-252 / Sprint 253-255 의 모든 AC 회귀 0.
- IPC 시그니처 0 변경.
- store 액션·상태 변경 0.
- Mongo grid read-only invariant 보존.
- 다중 statement 우선순위 (STOP > WARN > INFO) 보존 — Sprint 254/255 결정 보존.
- WARN dialog Cancel/X → IPC 미발동 + state clear (Sprint 255).
- SqlPreviewDialog / MqlPreviewModal / ConfirmDestructiveDialog 의 *기존* 외부 props 시그니처 보존 (필요 시 optional prop 추가만).
- `ENVIRONMENT_META` 5-tag 보존.
- TabBar 의 close button / dirty dot / preview italic / drag ghost / scrollIntoView / ConfirmDialog dirty-close / scrollRef onMouseUp 보존 (Sprint 253).
- `--tv-status-connecting` (`#f59e0b`) 보존.
- `chrome-prod-border` 클래스 또는 inline style 가 native title bar 와 충돌 없음 (macOS WKWebView 검증). Windows 차이는 documented residual risk.

## Verification Plan

- **Profile**: `command + manual smoke (window border)`
- **Required checks**:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 errors / 0 warnings)
  3. `pnpm vitest run` (전체 통과 + AC-256 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 — Rust 변경 0)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "EnvironmentChromeStripe|useActiveTabConnection|ExecuteButton" src/` (≥ 5 매치)
  7. `rg "var\(--tv-env-prod\)|var\(--tv-env-staging\)" src/` (≥ 3 매치 — stripe + ConfirmDestructiveDialog)

- **Required evidence**:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑 (7 ACs).
  - `useActiveTabConnection` 본문 인용 + 단위 테스트.
  - `EnvironmentChromeStripe` 본문 인용 + staging/prod text format 검증.
  - prod window border CSS / inline style 인용.
  - `ExecuteButton` 의 4 severity×env 매트릭스 인용.
  - 5 surfaces 의 Execute 버튼 교체 diff 인용.
  - ConfirmDestructiveDialog 헤더 token 정렬 diff.
  - prefers-reduced-motion 처리 인용.
  - 기존 회귀 테스트 (Sprint 245-255) 모두 pass — vitest stdout.
  - /tdd 흐름 증거 (red → green log).
  - 가정 (예: dev/null label 처리, conn label 폭 truncate 정책, mac 외 platform border 처리) / 잔여 위험.

## References

- Master spec: `docs/sprints/sprint-253/spec.md` §Sprint 256
- 13-question grill (Q4-(c) chrome top stripe + prod border / Q5-(b) color+target / Q6-(a) two dialogs separate): `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `memory/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- Sprint 253 baseline: `docs/sprints/sprint-253/contract.md` (commit 528063b)
- Sprint 255 baseline: `docs/sprints/sprint-255/contract.md` (commit b8600bc)
- Sprint 254 baseline: `docs/sprints/sprint-254/contract.md` (commit 2d518b2)
- Relevant files:
  - `src/App.tsx`
  - `src/AppRouter.tsx` (참조만 — workspace shell 위치)
  - `src/components/layout/EnvironmentChromeStripe.tsx` (신규)
  - `src/components/ui/ExecuteButton.tsx` (신규)
  - `src/hooks/useActiveTabConnection.ts` (신규)
  - `src/components/structure/SqlPreviewDialog.tsx`
  - `src/components/document/MqlPreviewModal.tsx`
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/query/EditableQueryResultGrid.tsx`
  - `src/components/workspace/ConfirmDestructiveDialog.tsx`
  - `src/types/connection.ts` (참조만 — `ENVIRONMENT_META`)
  - `src/themes.css` (참조만 — Sprint 253 의 6 env tokens)
