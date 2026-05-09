# Sprint Execution Brief: sprint-253

## Objective

ADR 0023 의 5-sprint chain (253→255→254→256→257) 의 foundation —
6 env-specific 토큰 신규 (`--tv-env-prod`/`-prod-wash`/`-prod-text`/
`-staging`/`-staging-wash`/`-staging-text`) + `--tv-warning` 깊이 조정
(`#f59e0b` → `#ea580c`, status-connecting amber 보존) + TabBar 좌측
connection-색 stripe 완전 제거 (item ②) + tab drag 빈 영역 release 시
cursor X 기반 가장 가까운 탭 옆 insert (item ④).

## Task Why

Sprint 252 polish 후 사용자 검토 중 발견된 4 issue 의 grill 결과
(`docs/sprints/sprint-253/grill-decisions.md` Q11, Q13) 와 후속 chrome
H + Button F + ConfirmDestructiveDialog 의 token 의존성을 동시에 해결.
가벼운 묶음으로 사용자 즉시 win + 후속 sprint 의 foundation. ADR 0023
의 *영구 환경 chrome* 은 token 없이 mount 불가 — 본 sprint 가
foundational.

## Scope Boundary

- 변경: `src/themes.css` (6 토큰 추가 + warning 값 변경), `src/components/
  layout/TabBar.tsx` (stripe 삭제 + scrollRef onMouseUp 추가), `src/
  components/layout/TabBar.test.tsx` (회귀 가드 + 신규 DnD 케이스).
- 변경 금지:
  - WARN dialog mount in raw SQL editor (Sprint 255).
  - Severity classifier 3-tier split (Sprint 254).
  - Chrome H 컴포넌트 (Sprint 256).
  - Button F (ExecuteButton) (Sprint 256).
  - 72-theme syntax palette (Sprint 257).
  - ConfirmDestructiveDialog 헤더 token 정렬 (Sprint 256).
  - `getConnectionColor` 로직 자체 — TabBar 에서만 제거.
  - Sprint 250-252 의 onBlur/Esc/store-lift/Copy/SqlSyntax 동작.
  - IPC / safeModeStore / persistence.

## Invariants

- `--tv-status-connecting` = `#f59e0b` (amber) 보존 — connecting 상태 의미.
- TabBar 의 close button / dirty dot / preview italic / drag ghost /
  scrollIntoView / ConfirmDialog dirty-close 보존.
- AC-251-S1..S5 H1..H5 T1..T3 R1..R4 / AC-250-01..06 / AC-249-U1..U9 /
  AC-248-* / AC-247-* / AC-246-* / AC-245-* / AC-186-* / AC-185-* /
  AC-109 모두 회귀 0.
- IPC / safeModeStore / persistence 변경 0.
- Mongo grid read-only invariant 보존.

## Done Criteria

1. `src/themes.css` 에 6 env-specific 토큰 universal scope 정의 + 모든
   theme 의 `--tv-warning` 값 `#f59e0b` → `#ea580c` 변경 (status-
   connecting amber 보존).
2. `TabBar.tsx` 의 connection-색 stripe IIFE 완전 삭제 + `getConnection
   Color` import 도 사용처 없으면 제거.
3. `TabBar.tsx` 의 scrollRef 컨테이너에 onMouseUp 핸들러 추가, drag
   상태 + 빈 영역 release 시 cursor X 기반 가장 가까운 탭 결정 →
   `moveTab(src, target, side)` 호출. 마지막 탭 우측 release → 끝으로.
4. AC-253-01..06 모두 매핑.
5. /tdd 흐름: 신규 테스트 먼저, fail → 구현 → pass.
6. Verification Plan 7개 check 모두 pass.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit` (0 errors)
  2. `pnpm lint` (0 / 0)
  3. `pnpm vitest run` (전체 통과 + AC-253 매핑 증거)
  4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` (회귀)
  5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  6. `rg "--tv-env-prod|--tv-env-staging" src/themes.css` (≥ 1 매치)
  7. `rg "getConnectionColor" src/components/layout/TabBar.tsx` (0 매치)
- Required evidence:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 7 check stdout 발췌.
  - AC ↔ 파일:라인 매핑 (6 ACs).
  - themes.css 의 6 env 토큰 + warning 값 변경 인용.
  - TabBar.tsx 의 stripe IIFE 삭제 diff 인용.
  - TabBar.tsx 의 scrollRef onMouseUp 본문 인용 (cursor X + bubble 가드).
  - /tdd 흐름 증거.
  - 가정 / 잔여 위험.

## Evidence To Return

- 변경 파일과 purpose
- Checks run and outcomes (7개)
- Done criteria coverage with evidence
- Assumptions (status-connecting amber 보존 검증, drag bubble 처리,
  단일 connection 워크플로 시각 영향)
- Residual risk (warning amber → orange 사용처의 미세한 시각 차이)

## References

- Spec (master): `docs/sprints/sprint-253/spec.md`
- Contract: `docs/sprints/sprint-253/contract.md`
- 13-question grill: `docs/sprints/sprint-253/grill-decisions.md`
- ADR 0023: `memory/decisions/0023-production-warning-environment-aware-chrome-and-warn-dialog/memory.md`
- Sprint 252 baseline: `docs/sprints/sprint-252/contract.md` + `findings.md`
- Relevant files:
  - `src/themes.css`
  - `src/components/layout/TabBar.tsx`
  - `src/components/layout/TabBar.test.tsx`
  - `src/lib/connectionColor.ts` (참조만, 변경 없음)
