# Sprint 191 — Findings

## 1. SchemaTree god component 의 데이터 레이어 분리

`docs/refactoring-smells.md` §2 가 SchemaTree 를 "1963 줄 god surface"
로 진단. Sprint 191 은 4가지 smell (§2 god / §3.1 직접 setState / §5
silent failure / §6 exhaustive-deps ignore) 중 **데이터 레이어 책임만
hook 으로 추출**하여 한 sprint 안에 일괄 처리. UI 트리를 props
컴포넌트로 분리하는 §51 b 항목은 후속.

분리된 책임:

- `loadSchemas` / `loadTables` / `loadViews` / `loadFunctions` /
  `prefetchSchemaColumns` 호출
- mount-시 자동 로드 + per-schema lazy expand
- refresh-schema window event listener
- 단일 schema 새로고침 (`evictSchemaForName` + 재로딩)
- `loadingSchemas` / `loadingTables` UI state

## 2. 라인 수 변화 — contract 목표 대비

| 파일 | Before | After | Δ |
|------|--------|-------|---|
| `src/components/schema/SchemaTree.tsx` | 1963 | 1915 | **-48** |
| `src/hooks/useSchemaCache.ts` (NEW) | 0 | 164 | +164 |
| `src/hooks/useSchemaCache.test.ts` (NEW) | 0 | 130 | +130 |

contract AC-191-05 의 목표 "1963 → ~1700 ± 100" 에는 미달. 이유:
1. 실제로 hook 으로 옮긴 데이터 레이어 코드는 ~50 줄 (mount useEffect +
   handleRefresh + handleRefreshSchema + handleExpandSchema 의 데이터
   호출 부분). 나머지 1900+ 줄은 트리 UI / context-menu / dialog /
   virtualization / row 렌더링.
2. hook 안에서 `.catch(() => {})` 9건 → `toast.error + console.error`
   로 교체하면서 분기가 풍부해져 line 자체는 hook 에서 늘어남.

응집도는 분명히 개선됐지만, **god component 의 본질적 분해는 UI 책임
까지 분리해야 의미가 큼** (§51 b — props 컴포넌트화). 본 sprint 의
효과는 후속 작업의 토대 마련에 가깝다.

## 3. store-swallowing 발견 — silent failure 의 실체

contract AC-191-03 가 "9개 silent catch → toast.error" 로 정의했으나,
실제 정찰 결과:

- `loadSchemas` / `loadTables` / `loadViews` / `loadFunctions` 의 5개
  catch 는 **store 안에서 이미 try/catch 로 reject 를 swallow** 하고
  `error: String(e)` state 만 기록 (`schemaStore.ts:171-181` 등).
- 따라서 hook level `.catch` 는 dead branch — toast.error 분기는
  **실제로는 발사되지 않는다**.

대응:
- hook 의 `.catch(toast.error + console.error)` 는 *forward compatibility*
  로 유지. store 가 throw 로 contract 를 바꾸면 즉시 활성화.
- 의미 있는 실제 sink 는 `useSchemaStore.error` state. 본 sprint 의
  `useSchemaCache.test.ts [AC-191-02-4]` 가 "rejection 이 store error 에
  기록되는지" 를 단언하는 것으로 정정.
- 진정한 사용자 가시 사인 (banner / toast 자동 displaty) 은 별 sprint —
  `useSchemaStore.error` 를 selector 로 읽어 SchemaTree 에 inline error
  banner 추가, 또는 store contract 를 throw 로 바꿈.

이 발견은 contract AC-191-03 의 의도 (silent failure 의 가시화) 가
부분적으로만 달성됐음을 의미. dropTable / renameTable 은 store 가
throw 하므로 SchemaTree 컴포넌트의 toast 가 **실제로 발사**됨 (테스트
`[AC-191-03-1]` `[AC-191-03-2]` 가 verbatim 단언).

## 4. `evictSchemaForName` 단일 액션화

`SchemaTree.tsx:603` 의 직접 `useSchemaStore.setState((state) => { ...
delete ... })` 가 store 의 cache key 규칙 (`${connectionId}:${schemaName}`)
을 UI 로 누설하고 있었다. Sprint 191 이 `evictSchemaForName(connectionId,
schemaName)` 액션 하나로 묶으면서 store 표면이 의도-기반이 됐다.

향후 cache key 형식을 `WeakMap<Connection, Map<string, Cache>>` 등으로
바꾸더라도 액션 시그니처는 그대로 유지 가능 — UI 회귀 0.

## 5. exhaustive-deps ignore 정정 (smell §6 완전 해소)

`SchemaTree.tsx:519` 의 `// eslint-disable-line react-hooks/exhaustive-deps`
가 제거됐다. `refreshConnection` 이 `useSchemaCache` 안에서 useCallback
으로 stable identity 를 가지므로 `[refreshConnection]` deps 가 자연스럽게
사용 가능. 정찰 결과 SchemaTree 에 다른 exhaustive-deps ignore 는 없음.

smell §6 의 SchemaTree 항목 1건이 **완전 해소** (남은 §6 항목 3건은
`DataGridTable`, `rdb/DataGrid`, `document/DocumentDatabaseTree` —
각자의 sprint 에서).

## 6. 후속 (본 sprint Out of Scope)

- **SchemaTree UI 를 props 컴포넌트로 분리** (§51 b). 1915 줄의
  selection / expansion / context-menu / dialog / virtualization /
  row rendering 을 sub-component 로 분해. Sprint 198 또는 별 sprint
  단위.
- **store 의 `error` state 를 사용자 가시화**. `useSchemaStore.error`
  selector → SchemaTree banner 또는 자동 toast. 본 sprint 가
  `useSchemaCache` 안에 hook 한 단을 두고 있어 해당 sprint 의
  토대로 활용 가능.
- **schemaStore 의 load 액션이 throw 로 contract 변경**. 현재 swallow
  + error state pattern 은 React Suspense / error boundary 와 호환성이
  낮음. 별 refactor sprint 후보.
- **SchemaTree.test.tsx 분할** (smell §8.1). 2721 줄 (+92 = 2813 줄
  지금) 은 여전히 거대. 본 sprint 의 신규 테스트 2건 (AC-191-03-{1,2})
  도 그 안에 합류.

## 7. AC → 테스트 매핑

| AC | 검증 위치 | 케이스 수 |
|----|-----------|-----------|
| AC-191-01 | `src/stores/schemaStore.test.ts` `[AC-191-01]` | 1 (액션 단위) |
| AC-191-02 | `src/hooks/useSchemaCache.test.ts` `[AC-191-02-1~4]` | 4 (mount / refresh / expand cached skip / store-swallowing 단언) |
| AC-191-03 | `src/components/schema/SchemaTree.test.tsx` `[AC-191-03-1,2]` | 2 (dropTable / renameTable failure → toast) |
| AC-191-04 | `pnpm lint` clean | 0 신규 (lint 가 검증) |
| AC-191-05 | line count 보고 | 0 (목표 미달, 현실 보고) |

## 8. 코드 변경 통계

- `src/stores/schemaStore.ts`: +18 / -0 (액션 1개 + interface 추가).
- `src/stores/schemaStore.test.ts`: +43 / -0 (신규 case 1).
- `src/hooks/useSchemaCache.ts`: +164 (NEW).
- `src/hooks/useSchemaCache.test.ts`: +130 (NEW).
- `src/components/schema/SchemaTree.tsx`: +66 / -114 (net -48). hook
  delegation + toast 분기 + 데드코드 정리.
- `src/components/schema/SchemaTree.test.tsx`: +92 / 0 (신규 case 2).

총 코드 6 modified/new + docs 3 신설.

## 9. 검증 4-set

- `pnpm vitest run` → **183 files / 2652 tests passed** (+1 file
  useSchemaCache.test.ts, +7 cases vs Sprint 190 baseline 182/2645).
- `pnpm tsc --noEmit` → 0 errors.
- `pnpm lint` → 0 warnings.
- `git diff --stat src-tauri/` → empty.
