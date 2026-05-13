# Sprint 270 Handoff — First-paint skeleton placeholders (perceived cold-boot)

## Status

Complete. Sprint 175 가 측정 cold-boot 1404 ms (WKWebView OS-parallel spawn
floor) 에서 막혀 AC ≥30% 미달성으로 retire 됨. 본 sprint 는 ms 수치 단축
대신 **perceived 성능** 우회 — 첫 paint 에 chrome 노출. `connectionStore`
에 `hasLoadedOnce: boolean` 런타임 flag (NOT in `SYNCED_KEYS` — window-local)
를 추가하고 `loadConnections` 의 success / error 양쪽 branch 에서 모두
flip. `WorkspaceSidebar` 와 `MainArea` 는 pre-hydrate (`connections.length
=== 0 && !hasLoadedOnce`) 시 shadcn `Skeleton` primitive (`animate-pulse
rounded-md bg-muted`) 로 sidebar 4-row + main-area logo/lines/button 골격을
노출. hydrate 완료 후 기존 "No connections yet" empty card / `EmptyState`
가 swap-in (byte-equivalent). cold-boot 측정값 변화 없이 빈 화면 → 깜빡임
gap 을 닫음.

## Acceptance Criteria — verification

| AC | 결과 |
|---|---|
| AC-270-01 sidebar skeleton at first paint | ✅ `src/components/workspace/WorkspaceSidebar.tsx:50-58` 두-step gate (`if (connections.length === 0) { if (!hasLoadedOnce) return <Skeleton/>; … }`), `:163-178` 4-row skeleton JSX (`h-8 w-full` / `h-8 w-4/5` 교차). Test `src/components/workspace/WorkspaceSidebar.test.tsx:127` |
| AC-270-02 main-area skeleton at first paint | ✅ `src/components/layout/MainArea.tsx:272-275` `hasLoadedOnce ? <EmptyState /> : <MainAreaSkeleton />` ternary (no-active-tab branch only). `:145-160` skeleton JSX (`h-20 w-20` logo + `h-4 w-3/5` + `h-4 w-2/5` + `h-8 w-32` button). Test `src/components/layout/MainArea.test.tsx:199` |
| AC-270-03 swap-order smooth (no "No connections yet" flash) | ✅ `src/components/workspace/firstPaintSkeleton.test.tsx:112` sidebar happy, `:147` main happy, `:182` rejection branch. 각 case 가 deferred-resolve `listConnections` mock 으로 t=0 skeleton 노출 + post-resolve swap 검증, `:131` 의 `queryByText(/no connections yet/i)).toBeNull()` 가 flash 부재 pin |
| AC-270-04 post-hydrate non-re-render on remount | ✅ `WorkspaceSidebar.test.tsx:147` + `:159` (remount), `MainArea.test.tsx:219` (remount). `hasLoadedOnce=true` 사전세팅 후 mount/unmount/remount → skeleton DOM 부재 |
| AC-270-05 회귀 가드 | ✅ vitest 3217 → 3232 (+15 monotonic, ≥+4 required), targeted 5 file 102/102, `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0. `SYNCED_KEYS` 불변 — `connectionStore.test.ts:813-815` regression pin |

## 주요 production 변경

| 파일 | 변경 |
|---|---|
| `src/stores/connectionStore.ts` | `ConnectionState` 에 `hasLoadedOnce: boolean` 추가 (L38 typedef, L112 initial `false`). `loadConnections` 의 success branch (L123) + error branch (L125) 양쪽에서 `true` flip — reject 시에도 skeleton 이 shimmering stuck 안 되게. **`SYNCED_KEYS` (L99-104) 는 `[connections, groups, activeStatuses, focusedConnId]` 그대로** — window-local 격리. WHY 코멘트 L30-37 (flag rationale), L119-122 (dual-branch flip rationale) |
| `src/components/ui/skeleton.tsx` | 신규 shadcn canonical primitive. Named export `Skeleton`, body `<div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />` (L13-23). `HTMLAttributes<HTMLDivElement>` passthrough, 추가 API surface 없음 |
| `src/components/workspace/WorkspaceSidebar.tsx` | 기존 top-level `if (connections.length === 0)` empty-card branch 를 두-step gate 로 분할 (L50-58): `!hasLoadedOnce` → `<WorkspaceSidebarSkeleton />` return, 그 외 기존 empty card (L59-72, byte-equivalent). `WorkspaceSidebarSkeleton` 내부 컴포넌트 (L163-178) — `role="status"` + `aria-busy="true"` + `aria-label="Loading connections"` + 4-row skeleton. active-tab / `pickSidebar` / 연결 카드 path 무변경 |
| `src/components/layout/MainArea.tsx` | no-active-tab fallback (L272-275) 을 `hasLoadedOnce ? <EmptyState /> : <MainAreaSkeleton />` 로 변경. `MainAreaSkeleton` 내부 컴포넌트 (L145-160) — logo (`h-20 w-20`) + 두 line + button-sized block + `role="status"` aria 마크업. 다른 tab type (table/query/...) branch 무변경 |

## 테스트

### Frontend (vitest) — 15 신규 케이스

전체 suite 3217 → 3232 (+15 monotonic).

**`src/components/ui/skeleton.test.tsx`** (신규 파일, 3 케이스)
- `:12` — `Skeleton` 이 `animate-pulse`, `rounded-md`, `bg-muted` 3개 class 모두 포함.
- `:25` — `className` prop 이 `cn` 으로 merge (canonical default 보존).
- `:38` — `HTMLAttributes` passthrough (`data-*`, `aria-*`, `id`).

**`src/stores/connectionStore.test.ts`** (extend, 4 케이스)
- `:813` — `SYNCED_KEYS` snapshot 이 정확히 `[connections, groups, activeStatuses, focusedConnId]` — `hasLoadedOnce` 부재 regression pin.
- `:826` — initial state `hasLoadedOnce === false`.
- `:840` — `loadConnections` success 후 `hasLoadedOnce === true`.
- `:856` — `loadConnections` error (mock reject) 후 `hasLoadedOnce === true` AND `error` 세팅 — skeleton 이 멈춰 있지 않음을 보장.

**`src/components/workspace/WorkspaceSidebar.test.tsx`** (extend, 3 케이스)
- `:127` — AC-270-01 pre-hydrate (`connections=[]`, `hasLoadedOnce=false`) 시 4-row skeleton + `"No connections yet"` 부재.
- `:147` — post-hydrate parity: `hasLoadedOnce=true` + `connections=[]` → 기존 empty card, skeleton 부재.
- `:159` — AC-270-04 remount: `hasLoadedOnce=true` 세팅 후 mount → unmount → remount, skeleton DOM 부재 유지.

**`src/components/layout/MainArea.test.tsx`** (extend, 2 케이스)
- `:199` — AC-270-02 no-active-tab + `hasLoadedOnce=false` → main-area skeleton (logo + lines + button) 마운트, `EmptyState` 부재.
- `:219` — AC-270-04 post-hydrate remount: `hasLoadedOnce=true` 세팅 후 `EmptyState` 마운트, skeleton 부재 (remount 이후에도 동일).

**`src/components/workspace/firstPaintSkeleton.test.tsx`** (신규 파일, 3 케이스)
- `:112` — AC-270-03 sidebar happy: deferred-resolve `listConnections` mock → t=0 sidebar skeleton 존재 + `"No connections yet"` 부재 (`:131` `queryByText(...).toBeNull()`) → `resolveList([])` 후 swap → skeleton 부재 + empty card 마운트.
- `:147` — AC-270-03 main happy: 동일 패턴으로 main-area skeleton → `EmptyState` swap. `queryByAltText("Table View")` 가 t=0 부재 (`:162`).
- `:182` — AC-270-03 rejection: `rejectList(new Error(...))` 후에도 `hasLoadedOnce=true` flip → skeleton 부재 + 기존 empty card 마운트 (error-specific surface 는 future scope).

Backend `cargo test` 변경 없음 (in-scope frontend / store 한정).

## Out of Scope

contract.md §Out of Scope 와 동일:

1. **Sprint 271 (`expected_database` 가드 propagation)** — 나머지 RDB
   introspection / DDL command. 별 sprint, backend 무변경.
2. **측정 cold-boot ms 단축** — Sprint 175 AC ≥30% 는 spec 으로 retire.
   본 sprint 는 perceived 성능만, rebaseline trial 없음. ms 단축은 별
   sprint.
3. **`prefers-reduced-motion` 명시 처리** — Tailwind `animate-pulse` 기본
   동작이 브라우저 레벨에서 user 의 reduced-motion 선호 존중. 커스텀
   keyframe 미도입.
4. **`RdbSidebar` / `DocumentSidebar` 내부 schema-tree skeleton** —
   post-hydrate 경로. 별 sprint.
5. **`loading` 플래그를 `hasLoadedOnce` 로 통합** — `loading` ("actively
   in flight") 과 `hasLoadedOnce` ("ever finished") 는 별개 semantics,
   둘 다 coexist.

## Lessons

- **Perceived vs measured 분리** — Sprint 175 가 5-trial 측정에서 1490 → 1404 ms
  (5.8%) 단축에 그치며 ≥30% AC 미달, WKWebView OS-parallel spawn 이 floor.
  같은 ms 라도 첫 paint 에 chrome (skeleton) 만 노출되면 user 는 "응답 중"
  으로 인지 — 빈 white window → 깜빡임 gap 은 ms 가 아니라 *visible state*
  의 부재였음. 본 sprint 는 ms 수치 0 변화로 UX gap 닫음. "측정 floor 에
  부딪힌 perf 목표는 perceived 우회를 검토" 라는 일반 원칙.
- **Runtime flag, not synced** — `hasLoadedOnce` 가 만약 `SYNCED_KEYS` 에
  들어가면 다른 창에서 hydrate 완료한 상태가 IPC bridge 로 leak 되어 새 창
  의 첫 paint 가 skeleton 을 안 띄움 (window-local "have I finished a load
  this session" semantics 깨짐). `persist`/localStorage 에도 미저장 — 의도
  격리. `connectionStore.ts:99-104` `SYNCED_KEYS` allowlist 와 `:813`
  regression pin 으로 두 곳에서 박제.
- **Test helper default flip — blanket patch 회피** — `setupStore` /
  `setConnections` 헬퍼의 `hasLoadedOnce` 디폴트를 `true` 로 설정 (50+
  pre-existing post-hydrate test 들을 그대로 통과시키기 위해). 신규
  pre-hydrate case 만 explicit `hasLoadedOnce: false` opt-in. JSDoc 으로
  default 의 의도를 inline 명시. 만약 default 를 `false` 로 했으면 50+
  test 를 일제히 patch 해야 했을 것 — blanket rewrite 가 아니라 default
  의 polarity 를 production 의 *typical* runtime state ("이미 한 번 load
  했다") 에 맞춤. "test helper 의 default 는 production 의 dominant
  steady-state 를 반영" 이라는 휴리스틱.
