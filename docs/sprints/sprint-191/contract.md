# Sprint 191 — Contract

Sprint: `sprint-191` (SchemaTree 분해 — 데이터 레이어 hook 추출 + 캐시
무효화 store 액션화 + 9개 silent failure toast 화 + exhaustive-deps
정정).
Date: 2026-05-02.
Type: refactor (홀수 sequencing — Sprint 192 의 sidebar 진입점 토대).

`docs/refactoring-smells.md` §2 (god surface), §3.1 (직접 setState), §5
(silent failure), §6 (exhaustive-deps ignore) 의 SchemaTree 항목을
한 sprint 안에 묶어 처리. 1963 줄 god component 의 **데이터 레이어
hook 추출** 까지가 본 sprint 범위. UI props 컴포넌트 분리는 Out of
Scope (god component 분해 묶음에서 별도 sprint).

## Sprint 안에서 끝낼 단위

- `useSchemaStore` 에 schema-단위 cache eviction 액션 추가 (store 표면
  수정).
- `src/hooks/useSchemaCache.ts` 신설 — load / refresh / prefetch +
  loading state 캡슐화.
- SchemaTree.tsx 의 데이터 레이어 호출지를 hook 으로 위임.
- 9개 `.catch(() => {})` → `toast.error` + dev console 일관 패턴.
- `react-hooks/exhaustive-deps` 무시 1건 정정.

## Acceptance Criteria

### AC-191-01 — `evictSchemaForName` store 액션

`src/stores/schemaStore.ts` 에 다음 액션 추가:

```ts
evictSchemaForName: (connectionId: string, schemaName: string) => void;
```

`tables[connectionId:schemaName]`, `views[연결:스키마]`, `functions[연결:스키마]`
세 키를 한 번의 set 호출로 제거. 의도가 드러나는 액션 명 ("schema
한 개 단위 cache 무효화"). 호출지: `SchemaTree.tsx:603` 의 직접
`useSchemaStore.setState((state) => { ...delete... })` 를 액션 호출로
교체.

검증:
- `src/stores/schemaStore.test.ts` 에 액션 단위 테스트 1건 추가
  (initial state 에 3 key 모두 존재 → 액션 호출 → 3 key 모두 제거,
  다른 schemaName 의 키는 보존).
- SchemaTree.test.tsx 의 refresh-schema 케이스가 그대로 pass (UI
  관점에서는 동일 효과).

### AC-191-02 — `useSchemaCache` hook 추출

`src/hooks/useSchemaCache.ts` 신설. 시그니처:

```ts
interface UseSchemaCacheReturn {
  schemas: SchemaInfo[];
  loadingSchemas: boolean;
  loadingTables: ReadonlySet<string>;  // schemaName 들의 in-flight Set
  refreshConnection(): void;            // 전체 schema 재로딩
  refreshSchema(schemaName: string): void;  // 단일 schema 재로딩 + cache evict
  expandSchema(schemaName: string): Promise<void>; // schema 첫 expand 시 lazy load
}

export function useSchemaCache(connectionId: string): UseSchemaCacheReturn;
```

내부 책임:
- `useEffect` 로 mount 시 `loadSchemas` + 모든 schema 의 `loadTables` /
  `prefetchSchemaColumns` 자동 호출 (현재 SchemaTree:495-512 의 로직).
- `loadingSchemas` / `loadingTables` state 보유.
- 위 4개 메서드의 catch 분기를 hook 안에서 `toast.error("Failed to ...")
  + console.error(err)` 로 일원화.
- expandSchema 에서 `tables` / `views` / `functions` 의 cached 여부
  검사 후 빠진 것만 load.
- `refresh-schema` window event listener 도 hook 안에서 등록.

### AC-191-03 — `.catch(() => {})` 9건 toast 화

다음 9 호출지의 silent catch 를 일관 패턴으로 교체:

| Line | 호출 | 새 패턴 |
|------|------|---------|
| 505 | loadTables (mount nested) | hook 내부, `Failed to load tables for ${schemaName}` |
| 510 | loadSchemas (mount) | hook 내부, `Failed to load schemas` |
| 573 | loadTables (expand) | hook 내부, 동일 메시지 |
| 584 | loadViews (expand) | hook 내부, `Failed to load views for ${schemaName}` |
| 587 | loadFunctions (expand) | hook 내부, `Failed to load functions for ${schemaName}` |
| 594 | loadSchemas (refresh) | hook 내부, `Failed to refresh schemas` |
| 613 | loadTables (refreshSchema) | hook 내부, `Failed to reload tables` |
| 621 | loadViews (refreshSchema) | hook 내부, 동일 |
| 622 | loadFunctions (refreshSchema) | hook 내부, 동일 |
| 697 | dropTable | UI 컴포넌트, `Failed to drop ${schema}.${table}: ${err}` |
| 738 | renameTable | UI 컴포넌트, `Failed to rename ${schema}.${table}: ${err}` |

dev console: `import.meta.env.DEV` 분기로 `console.error` 1줄.

검증:
- `SchemaTree.test.tsx` 의 happy-path 테스트는 모두 pass (mock 이
  resolve 하므로 catch 분기 미진입).
- 신규 테스트 1건 — `useSchemaCache.test.ts` 에서 `loadSchemas` 가
  reject 하면 toast.error 가 호출되는지 단언.
- UI dialog 의 dropTable 실패 시 toast 단언은 SchemaTree.test.tsx 에
  추가 (1건). rename 동일.

### AC-191-04 — exhaustive-deps ignore 정정

`SchemaTree.tsx:519` 의 `// eslint-disable-line react-hooks/exhaustive-deps`
를 제거. handler 가 `handleRefresh` (useCallback memo) 에 의존하므로
`[handleRefresh]` 를 deps 로 명시. 본 sprint 의 hook 추출 후엔
`handleRefresh` 가 hook 의 `refreshConnection` 으로 대체되므로 deps
가 자연스럽게 정상화된다.

검증:
- `pnpm lint` → 0 warnings, 0 errors.
- 기존 테스트 그대로 pass (refresh-schema 이벤트 핸들링 동작은 hook
  안으로 옮겨졌지만 같은 로직).

### AC-191-05 — SchemaTree.tsx 의 line count 감소

목표: 1963 → 약 1700 줄 ± 100 (200~300 줄 hook 으로 이전).
hard cut-off 단언은 안 함 (라인 수보다 응집도가 우선) — findings 에서
실측치 보고.

## Out of Scope

다음 항목은 본 sprint 에서 손대지 **않는다**.

- **UI 트리를 순수 props 컴포넌트로 분리**. 1963 줄의 나머지 ~1700 줄
  (selection / expansion / context menu / dialog / row rendering /
  virtualization) 을 props-only 컴포넌트로 분리. 별 sprint 단위
  (Sprint 198 또는 후속). 본 sprint 만으로도 god component 의
  데이터 책임이 분리되어 후속 작업 토대 마련.
- **SchemaTree.test.tsx 의 분할**. 2721 줄 테스트의 분할은 smell §8.1
  defer 항목 (`docs/refactoring-plan.md` §108).
- **schemaStore 자체의 분해** — store 가 schema/table/view/function/
  query 5개 책임을 한 store 에 묶어 두고 있으나, store 분해는 별
  refactor sprint.
- **handleDropTable / handleConfirmRename 의 dialog 분리**. 본 sprint
  는 silent catch 만 정리. dialog state 자체의 컴포넌트화는 후속.
- **prefetchSchemaColumns 정책 변경** (예: lazy 로딩으로 swap).
  성능 측정 필요한 별 sprint.

## 기준 코드 (변경 surface)

- `src/stores/schemaStore.ts` — 액션 1개 추가.
- `src/stores/schemaStore.test.ts` — 액션 단위 테스트 1건.
- `src/hooks/useSchemaCache.ts` (NEW) — 데이터 레이어 hook.
- `src/hooks/useSchemaCache.test.ts` (NEW) — 최소 4 case (mount load /
  expand cached skip / refresh evict / load failure → toast).
- `src/components/schema/SchemaTree.tsx` — 데이터 레이어 호출지 → hook.
  silent catch 9개 제거. exhaustive-deps ignore 1건 제거.
- `src/components/schema/SchemaTree.test.tsx` — 신규 테스트 2건
  (dropTable 실패 → toast / renameTable 실패 → toast). 기존 케이스
  베이스라인 유지.

## Dependencies

- Sprint 190 closure: 본 sprint 와 무관 (SafeMode store 만 건드림).
  순서 swap 가능했으나 refactoring-plan §80 에 따라 SafeMode 컨텍스트
  먼저 묶고 SchemaTree 진입.
- Sprint 192 (FB-3 DB 단위 export) 의 sidebar context menu 진입점이
  SchemaTree.tsx 본체에 추가될 예정. 본 sprint 가 SchemaTree 의 표면을
  먼저 정리해 두면 192 의 진입점 추가 review 가 쉬워진다.

## Refs

- `docs/refactoring-smells.md` §2, §3.1, §5, §6 — SchemaTree 진단.
- `docs/refactoring-plan.md` §51 — SchemaTree 분해 4단계.
- `memory/conventions/refactoring/store-coupling/memory.md` B-1 — UI 직접
  setState 금지.
- `memory/conventions/refactoring/lib-hook-boundary/memory.md` D-2 —
  components → hooks → lib import 방향.
