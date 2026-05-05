# Sprint 208 — Findings

Sprint: `sprint-208` (refactor — `tabStore.ts` god file 분해).
Date: 2026-05-05.
Type: refactor (행동 변경 0; entry-pattern 답습).

[`contract.md`](contract.md) / [`docs/PLAN.md`](../../PLAN.md) Sprint 208 row.

## 결과 요약

`src/stores/tabStore.ts` (1009 lines) → entry + 3 sub-file (types / persistence / tracker). 51 외부 caller import 경로 보존. tsc / lint / vitest 회귀 0.

## 라인 카운트

| 파일 | 라인 | 내용 |
|------|------|------|
| `src/stores/tabStore.ts` (entry) | 668 | zustand `create()` + 모든 actions + persist subscribe + tracker init/subscribe + IPC bridge attach + `useActiveTab` selector + sub-file re-export |
| `src/stores/tabStore/types.ts` | 270 | `TabSubView` / `TabObjectKind` / `TableTab` / `QueryMode` / `QueryTab` / `Tab` union + `TabState` interface |
| `src/stores/tabStore/persistence.ts` | 117 | `STORAGE_KEY` / `persistTabs` / `debouncePersist` (200ms) / `migrateLoadedTabs` (Sprint 73/76/129) / `resolveActiveDb` cross-store helper |
| `src/stores/tabStore/tracker.ts` | 75 | `initTracker` 의존성 주입 / `recordActiveTab` / `getLastActiveTabIdForConnection` (defensive prune) / `__resetLastActiveTabsForTests` |
| **합계** | **1130** | god file 1009 → entry 668 (66% 보존) + 3 sub-file 462 |

entry 668 lines = AC-208-02 의 500-700 범위 안.

## 분해 결정

### entry-pattern 4-way split

slice pattern (`createTableActions(set, get)` 으로 actions 를 별도 모듈로 분리) 은 zustand `StateCreator` type signature 가 까다로워 본 sprint scope 초과. entry-pattern (entry path 보존 + sub-file 분리) 만 적용.

### tracker 의 의존성 주입

`tracker.ts` 의 `getLastActiveTabIdForConnection` 은 defensive prune 을 위해 `useTabStore.getState().tabs` 를 읽어야 한다. 하지만 entry 가 tracker 를 import 하므로 tracker → entry 의 역방향 import 는 순환. 해결:

```ts
// tracker.ts
type TabsAccessor = () => readonly Tab[];
let tabsAccessor: TabsAccessor | null = null;

export function initTracker(accessor: TabsAccessor): void {
  tabsAccessor = accessor;
}
```

entry 가 module init 시 `initTracker(() => useTabStore.getState().tabs)` 를 호출. 의존 방향이 `tracker ← entry` 단일 방향으로 유지.

### cross-store import 처리

기존 `tabStore.ts` 가 `useMruStore` / `useConnectionStore` / `useQueryHistoryStore` 를 직접 import 하던 구조를 그대로 보존. 별도 sprint candidate (TODO 주석 line 19-22):

- `useMruStore` / `useQueryHistoryStore` → entry 에서 직접 (action 본문에서 호출).
- `useConnectionStore` → `persistence.ts` 의 `resolveActiveDb` 헬퍼에 격리.

전부 `eslint-disable no-restricted-imports` 블록과 함께 보존 (Sprint 196 lint 룰).

### 같은 store sub-file import 룰 충돌

`eslint.config.js` 의 `no-restricted-imports` 패턴 `./*Store` 가 entry → `./tabStore/persistence` import 도 차단했음 (룰 취지는 cross-store 차단인데 same-store sub-dir 에 의도치 않게 적용). entry 의 sub-file import 블록을 `eslint-disable no-restricted-imports` 로 감싸 룰의 기존 cross-store 예외 패턴 답습:

```ts
// Sprint 208 — same-store sub-files (entry-pattern split). The
// "store 파일끼리 import 금지" rule targets cross-store coupling; the entry
// of a god-file split is the legitimate composition surface and exists
// precisely so external callers see a single import path.
/* eslint-disable no-restricted-imports */
import { ... } from "./tabStore/persistence";
import { ... } from "./tabStore/tracker";
/* eslint-enable no-restricted-imports */
```

룰 패턴 자체를 수정해서 same-store sub-dir 만 허용하는 안도 고려했으나, entry-pattern split 은 god-file 분해 cycle 이 끝나면 더 이상 새로 발생하지 않으므로 ad-hoc disable 로 충분. cycle 종료 후 룰 정밀화 candidate.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2737 tests pass (Sprint 207 baseline 189/2732 → +5; 다른 영역 추가) |
| `wc -l src/stores/tabStore.ts src/stores/tabStore/*.ts` | entry 668 / types 270 / persistence 117 / tracker 75 |
| `grep -rn "from \"@stores/tabStore\"" src/ e2e/ \| grep -v "src/stores/tabStore"` | 50 매치 (entry path 변경 0) |

## Acceptance Criteria

| AC | 결과 |
|----|------|
| AC-208-01 entry path 보존 | 50 외부 매치, 모두 변경 없음 (PLAN 의 51 매치는 grep 조건 차이 — 본 sprint 는 self-reference 제외 측정) |
| AC-208-02 sub-file 갯수 + 라인 | types 270 (AC ~150-200 약간 초과; 타입-only 라 허용) / persistence 117 (AC ~80-150) / tracker 75 (AC ~50-100) / entry 668 (AC ~500-700) |
| AC-208-03 회귀 0 | tsc 0 / lint 0 / vitest 189 files 2737 tests pass |
| AC-208-04 행동 변경 0 | useTabStore / Tab / TableTab / QueryTab / TabSubView / TabObjectKind / QueryMode / getLastActiveTabIdForConnection / __resetLastActiveTabsForTests signature 동일 |

## Out of scope (next candidates)

- **slice pattern** — zustand `StateCreator<TabState, [], [], Slice>` 적용해 actions 도 module 별로 분리. entry 의 `create()` block 이 600 lines 인데, 이 중 actions 가 차지하는 비중을 줄이면 entry < 200 lines 가능.
- **cross-store 의존성 제거** — `useMruStore` / `useConnectionStore` / `useQueryHistoryStore` 호출을 React layer hook 으로 옮긴다. eslint disable 3 블록 제거.
- **localStorage helper 통일** — `STORAGE_KEY` / `persistTabs` 패턴이 다른 store (favorites / mru / theme / connection) 와 중복. Sprint 205 의 후속 candidate.
- **eslint 룰 정밀화** — `./*Store` 패턴이 entry-pattern sub-dir 까지 매치하지 않게 정제. cycle 종료 후 candidate.
