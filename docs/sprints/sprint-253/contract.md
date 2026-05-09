# Sprint Contract: sprint-253

## Summary

- Goal: ADR 0023 의 5-sprint chain 의 foundation — (a) 6 env-specific
  토큰 신규 + `--tv-warning` 깊이 조정, (b) TabBar 좌측 connection-색
  stripe 제거 (item ②), (c) tab drag 빈 영역 release 시 cursor X 로
  가장 가까운 탭 옆 insert (item ④). 가벼운 polish 묶음으로 사용자
  즉시 체감 + 후속 sprint 의 token 의존성 foundation.
- Audience: Generator + Evaluator agents (harness, /tdd 스타일).
- Owner: Sprint 253.
- Verification Profile: `command`.

## In Scope

### 토큰 추가 + warning 깊이 조정 (`src/themes.css`)

- 6 env-specific 토큰을 universal (theme-independent) scope 에 정의.
  적절한 위치는 `src/themes.css` 최상단의 `:root` 또는 모든 theme 에
  공통 적용되는 위치. 모든 72 theme variant 가 access 가능해야 함:
  ```css
  --tv-env-prod: #dc2626;
  --tv-env-prod-wash: #fef2f2;
  --tv-env-prod-text: #7f1d1d;
  --tv-env-staging: #ea580c;
  --tv-env-staging-wash: #fff7ed;
  --tv-env-staging-text: #7c2d12;
  ```
- `--tv-warning` 의 값을 모든 theme variant 에서 `#f59e0b` (amber) →
  `#ea580c` (deep orange) 로 변경.
  - 단 `--tv-status-connecting` 은 `#f59e0b` 보존 (의미 충돌 회피 —
    "connecting" 은 amber, "warning/staging" 은 orange).
  - 현재 `src/themes.css` 에서 `--tv-warning` 의 정의 위치는 `:root`
    및/또는 각 theme block. `rg --tv-warning src/themes.css` 로 모든
    위치 식별 후 일괄 갱신.
- `src/index.css` 의 Tailwind alias (`--color-warning: var(--tv-warning)`)
  는 변경 없음 (참조만).

### TabBar 좌측 connection-색 stripe 제거 (`src/components/layout/TabBar.tsx`)

- `TabBar.tsx:198-213` 의 inline IIFE (connection 색 stripe 렌더링)
  완전 삭제:
  ```tsx
  {(() => {
    const conn = connections.find((c) => c.id === tab.connectionId);
    if (!conn) return null;
    const color = getConnectionColor(conn);
    const isActive = tab.id === activeTabId;
    return (
      <span ... style={{ backgroundColor: color }} ... />
    );
  })()}
  ```
- `getConnectionColor` import 가 TabBar.tsx 에서만 사용됐다면 import
  도 제거. 다른 사용처 있다면 import 유지 (검색 후 확인).
- 기존 `useConnectionStore` selector `connections` 가 다른 용도로
  쓰이지 않으면 그것도 제거.
- 회귀 테스트 가드: `TabBar.test.tsx` 에 connection 색 affordance 가
  더 이상 없음을 단언하는 테스트 추가 (or 기존 테스트 제거).

### Tab drag 빈 영역 release — cursor X 기반 insert (`src/components/layout/TabBar.tsx`)

- `scrollRef` 컨테이너 `<div role="tablist">` 에 `onMouseUp` 핸들러
  추가:
  - `dragStateRef.current?.isDragging === true` 인지 확인. 아니면 no-op.
  - cursor X 와 strip 안 모든 `[data-tab-id]` element 의 boundingClient
    Rect 비교 → 가장 가까운 탭 결정.
  - 결정된 탭의 `before` / `after` 판정 (cursor X 가 rect.left + rect.
    width / 2 미만이면 before, 이상이면 after).
  - source tabId 와 target tabId 가 동일하면 no-op.
  - `moveTab(sourceTabId, targetTabId, side)` 호출.
- 기존 탭-단위 onMouseUp (`TabBar.tsx:186-196`) 과의 중복 방지:
  - 탭 위 release → child onMouseUp 이 먼저 발동, 거기서 `moveTab` 호출.
  - bubble 로 strip onMouseUp 도 발동될 수 있음 — strip 핸들러는
    *child onMouseUp 의 결과를 신호로* 인지하기 어려움 → 가드:
    `dragStateRef.current === null` 이면 (child 가 처리하고 reset 한 후
    bubble 한 케이스) skip.
  - 또는 child onMouseUp 에 `e.stopPropagation()` 추가 + strip 의
    onMouseUp 은 빈 영역 발동 전용으로 사용.
- 마지막 탭 우측 빈 영역 release → strip 의 모든 탭 중 가장 X 큰 탭
  의 right edge 와 cursor X 비교 → cursor 가 그 right edge 이상이면
  after (= 끝으로 이동).

### 회귀 가드 (변경 없음)

- TabBar 의 close button / dirty dot / preview tab italic / drag ghost
  / scrollIntoView 모두 보존.
- 다른 테마 사용처 (`SqlPreviewDialog`, `DataGrid` 등) 의 token 사용
  기존대로 — `--tv-warning` 색만 깊어짐 (시각 회귀 micro-test 가드).

## Out of Scope

- WARN dialog mount in raw SQL editor (Sprint 255).
- Severity classifier 3-tier split (Sprint 254).
- Chrome H 컴포넌트 (top stripe / window border) — Sprint 256.
- Button F (ExecuteButton) — Sprint 256.
- 72-theme syntax palette 큐레이션 — Sprint 257.
- ConfirmDestructiveDialog 헤더 token 정렬 — Sprint 256.
- `getConnectionColor` 로직 자체 변경 — TabBar 에서만 제거, sidebar
  등 다른 사용처에서는 보존.
- Connection edit dialog 의 environment 필드 변경 (Q9: null 보존, force-
  pick X — 변경 없음).

## Invariants

- TabBar 의 모든 다른 affordance (close, dirty, preview italic, drag
  ghost, scrollIntoView, ConfirmDialog for dirty close) 보존.
- `--tv-warning` 의 *기존 사용처* (toast warning, validation hint 등)
  가 amber → orange 로 시각 회귀 — *의도된 변화* 이며 시각 회귀로
  count 안 함. 단 `--tv-status-connecting` 은 amber `#f59e0b` 보존
  (connecting state 의 시각 의미 보존).
- Sprint 250-252 의 모든 AC 회귀 0.
- Sprint 245-249 SafeMode AC 회귀 0.
- Mongo grid read-only invariant 보존.
- IPC / safeModeStore / persistence 변경 0.

## Acceptance Criteria

(spec 의 AC-253-01 ~ AC-253-06 그대로)

- `AC-253-01` `src/themes.css` 에 6 env-specific 토큰이 universal
  scope (모든 72 theme variant 가 inherit) 로 정의된다. `rg "--tv-env-
  prod" src/themes.css` 로 ≥ 1 매치 확인.
- `AC-253-02` `--tv-warning` 의 값이 모든 theme 에서 `#ea580c` 로 변경.
  `--tv-status-connecting` 은 `#f59e0b` 그대로. `rg "tv-warning:#?ea580c"
  src/themes.css` 로 모든 theme 에서 매치 확인 (또는 universal 정의 1개).
- `AC-253-03` `TabBar.tsx` 에서 connection-색 좌측 stripe IIFE 가 완전
  삭제. `rg "getConnectionColor" src/components/layout/TabBar.tsx` 로
  0 매치.
- `AC-253-04` TabBar scrollRef 에 onMouseUp 핸들러 부착, 빈 영역 release
  시 cursor X 기반 insert. Vitest 로 (a) 마지막 탭 우측 빈 영역 release
  → 끝으로 이동, (b) 두 탭 사이 gap release → 가장 가까운 탭 옆 insert,
  (c) drag 미발동 상태의 release → no-op 검증.
- `AC-253-05` 기존 탭-단위 onMouseUp 동작 회귀 0 — 탭 위 release 시
  중복 reorder 발생하지 않음. Vitest 로 동일 탭 위 release → moveTab
  1회만 호출 검증.
- `AC-253-06` 모든 vitest 회귀 통과 (Sprint 252 baseline 3017 + 신규
  ≈ 3-5 case).

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과 (예상 ≥ 3020 — Sprint 252 baseline 3017 +
  신규 케이스).
- `it.skip` / `it.todo` / `xit` 도입 금지.
- /tdd 스타일: Generator 는 신규 테스트를 먼저 작성해 fail 을 확인한 후
  구현하고, 최종 단계에서 모든 테스트 pass 를 보고한다 (handoff 에
  "tests written first" 명시).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-253-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드
   (Rust 미변경).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.
6. `rg "--tv-env-prod|--tv-env-staging" src/themes.css` — env 토큰 정의
   ≥ 1 (universal).
7. `rg "getConnectionColor" src/components/layout/TabBar.tsx` — 0 매치
   (stripe 제거 확인).

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌 (passing 확인).
  - `[AC-253-*]` ↔ 테스트 파일:라인 매핑 표 (6 ACs).
  - themes.css 의 6 env 토큰 + warning 값 변경 인용.
  - TabBar.tsx 의 stripe IIFE 삭제 diff 인용.
  - TabBar.tsx 의 scrollRef onMouseUp 본문 인용 (cursor X 계산 + bubble
    가드).
  - /tdd 흐름 증거: 신규 테스트가 먼저 작성됐음을 단 한 줄로 확인.
  - 가정 / 잔여 위험.
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - 6 env 토큰 verbatim 존재 확인.
  - `--tv-warning: #ea580c` 모든 theme 에서 일관 적용 확인.
  - TabBar 의 connection 색 affordance 완전 부재 확인 (`rg getConnection
    Color src/components/layout/TabBar.tsx` = 0).
  - DnD 빈 영역 케이스 테스트 spot-check.

## Test Requirements

### Unit Tests (필수, /tdd)

- `src/components/layout/TabBar.test.tsx` 회귀 가드 — connection 색
  affordance 단언 제거, 신규 DnD 케이스 (3 case) 추가.
- 기존 다른 테스트 회귀 — 변경 없이 통과.

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — drag 후 마지막 탭 우측 빈 영역 release → 끝으로 이동.
- [x] 에러/예외 — drag 미발동 상태 release → no-op.
- [x] 경계 조건 — 두 탭 사이 gap release / 동일 탭 위 release / drag
  미발동 release.
- [x] 회귀 없음 — close button / dirty dot / preview italic / scroll
  IntoView / ConfirmDialog dirty-close 모두 통과.

## Test Script / Repro Script

```bash
git diff --stat HEAD

# /tdd: 신규 테스트가 먼저 작성됐는지 git log 로 확인 가능

# 1. 타입체크
pnpm tsc --noEmit

# 2. 린트
pnpm lint

# 3. 변경 영역 타겟 테스트
pnpm vitest run \
  src/components/layout/TabBar.test.tsx

# 4. 전체 회귀
pnpm vitest run

# 5. Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# 6. Wire-up grep
rg "--tv-env-prod|--tv-env-staging" src/themes.css
rg "getConnectionColor" src/components/layout/TabBar.tsx
```

## Ownership

- Generator: harness Generator agent (general-purpose), /tdd 스타일.
- Write scope: 위 In Scope 의 파일들만. Sprint 254-257 작업 금지.
- Merge order: 단일 commit 권장 — token + stripe 제거 + DnD 는 atomic.
  lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- /tdd 흐름 증거 (테스트 먼저 작성됐음을 handoff 가 명시).
- Sprint 250-252 / 245-249 invariants 보존.
