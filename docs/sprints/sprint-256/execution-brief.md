# Sprint Execution Brief: sprint-256

## Objective

영구 환경 chrome (top stripe + prod-only window border) + 모든 Execute
버튼의 color × target 라벨 + ConfirmDestructiveDialog 헤더 env token
정렬. ADR 0023 의 *영구 환경 chrome* 시각 polish 통합 — 사용자
발화 "production인데 수정하겠냐 같은 색 담은 메시지가 낫지" 의 핵심
구현 sprint.

## Task Why

ADR 0023 grill Q4-(c) "top stripe + prod-only window border 만 채택"
+ Q5-(b) "color × target, no verb" + Q6-(a) "두 dialog 별개 + env token
정렬" 의 시각 polish 통합. Sprint 253 의 token foundation 위에 chrome
mount + Execute 버튼 composition 으로 사용자가 *항상* 활성 탭의
환경을 시각적으로 인지. Sprint 254-255 의 분류·dialog mount 와 맞물려
"잘못된 환경에 잘못된 query" 사고 방지 강화.

## Scope Boundary

### 변경
- `src/hooks/useActiveTabConnection.ts` (신규) — 활성 탭 connection 추적 hook.
- `src/components/layout/EnvironmentChromeStripe.tsx` (신규) — top stripe.
- `src/components/ui/ExecuteButton.tsx` (신규) — composed Execute button.
- `src/App.tsx` — top stripe mount + prod border.
- `src/components/structure/SqlPreviewDialog.tsx` — Execute → ExecuteButton.
- `src/components/document/MqlPreviewModal.tsx` — Execute → ExecuteButton.
- `src/components/rdb/DataGrid.tsx` — 인라인 preview Execute → ExecuteButton.
- `src/components/query/EditableQueryResultGrid.tsx` — toolbar Execute → ExecuteButton.
- `src/components/workspace/ConfirmDestructiveDialog.tsx` — footer Execute → ExecuteButton + 헤더 env token 정렬.
- 신규 단위 테스트 (3 신규 컴포넌트 / hook + 회귀 테스트 5 surfaces).

### 변경 금지
- Per-theme syntax palette — Sprint 257.
- Severity classifier — Sprint 254 (3-tier 보존).
- WARN dialog mount logic — Sprint 255 (state shape 보존).
- TabBar polish — Sprint 253 (보존).
- 6 env tokens 정의 — Sprint 253 (themes.css 보존).
- IPC (`executeQuery`, `executeQueryDryRun`, `aggregateDocuments`, `findDocuments`, `cancelQuery`).
- safeModeStore / connectionStore / tabStore / queryHistoryStore 액션·상태.
- Mongo grid read-only invariant.
- `ENVIRONMENT_META` 5-tag.
- `--tv-status-connecting` (#f59e0b).
- ADR 0022 / Sprint 250-252 polish.
- AC-255 / AC-254 / AC-253 의 모든 동작.

## Invariants

- IPC 시그니처 0 변경.
- store 액션·상태 변경 0.
- ADR 0022 Phase 1-5 / Sprint 250-252 / Sprint 253-255 모든 AC 회귀 0.
- AC-255-01..06 / AC-254-01..07 / AC-253-01..06 / AC-251-S1..S5 H1..H5 T1..T3 R1..R4 / AC-250-01..06 / AC-249-U1..U9 / AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* / AC-109 모두 회귀 0.
- SqlPreviewDialog / MqlPreviewModal / ConfirmDestructiveDialog 외부 props 시그니처 보존 (필요 시 optional prop 추가만).
- TabBar 보존 (Sprint 253).
- `pendingRdbWarn` / `pendingMongoWarn` shape 보존 (Sprint 255).
- chrome stripe / border 가 비-staging 비-prod 환경 시 *완전히 미렌더* — 시각 부재 자체가 안전 신호.

## Done Criteria

1. `useActiveTabConnection` hook 신설 — 활성 탭 → connection 추적.
2. `EnvironmentChromeStripe` — staging/prod 활성 시 top stripe 렌더 (배경 + 텍스트 + prod 펄스 dot).
3. App shell 외곽에 prod 활성 시 1px env-prod border.
4. 활성 탭 전환 → chrome 즉시 갱신 (one-frame).
5. `prefers-reduced-motion: reduce` → 펄스 dot animation skip.
6. `ExecuteButton` — severity × env 4-매트릭스 color + `Execute on <conn>` (env ≠ null/dev) 라벨.
7. 5 surfaces 의 Execute 버튼 ExecuteButton 으로 교체.
8. ConfirmDestructiveDialog 헤더 env token 정렬 (`--tv-env-prod` / `-prod-text`).
9. AC-256-01..07 모두 매핑.
10. /tdd 흐름: 신규 테스트 먼저, fail → 구현 → pass.
11. Verification Plan 7개 check 모두 pass.

## Verification Plan

- **Profile**: `command + manual smoke (window border)`
- **Required checks**:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-256 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀 — Rust 변경 0)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "EnvironmentChromeStripe|useActiveTabConnection|ExecuteButton" src/` (≥ 5 매치)
  7. `rg "var\(--tv-env-prod\)|var\(--tv-env-staging\)" src/` (≥ 3 매치)

## Evidence To Return

- 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
- 7 check stdout 발췌.
- AC ↔ 파일:라인 매핑 (7 ACs).
- `useActiveTabConnection` 본문 + 단위 테스트.
- `EnvironmentChromeStripe` 본문 + staging/prod text format / 펄스 dot reduced-motion 인용.
- prod window border CSS / inline style 인용.
- `ExecuteButton` 의 4-매트릭스 + label truncate / tooltip 인용.
- 5 surfaces 의 교체 diff 인용.
- ConfirmDestructiveDialog 헤더 token 정렬 diff.
- 기존 회귀 (Sprint 245-255) 모두 pass — vitest stdout.
- /tdd 흐름 증거 (red → green log).
- 가정 (예: dev/null label, conn label 폭, Windows 차이) / 잔여 위험.

## References

- Spec (master): `docs/sprints/sprint-253/spec.md` §Sprint 256
- Contract: `docs/sprints/sprint-256/contract.md`
- 13-question grill (Q4-(c) + Q5-(b) + Q6-(a)): `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `docs/archives/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- Sprint 253 baseline: `docs/sprints/sprint-253/contract.md` (commit 528063b)
- Sprint 255 baseline: `docs/sprints/sprint-255/contract.md` (commit b8600bc)
- Sprint 254 baseline: `docs/sprints/sprint-254/contract.md` (commit 2d518b2)
- Relevant files:
  - `src/App.tsx`
  - `src/AppRouter.tsx`
  - `src/components/layout/EnvironmentChromeStripe.tsx` (신규)
  - `src/components/ui/ExecuteButton.tsx` (신규)
  - `src/hooks/useActiveTabConnection.ts` (신규)
  - `src/components/structure/SqlPreviewDialog.tsx`
  - `src/components/document/MqlPreviewModal.tsx`
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/query/EditableQueryResultGrid.tsx`
  - `src/components/workspace/ConfirmDestructiveDialog.tsx`
  - `src/types/connection.ts` (참조만)
  - `src/themes.css` (참조만)
