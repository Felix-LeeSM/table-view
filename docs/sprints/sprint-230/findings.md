# Sprint 230 — Findings

Sprint: `sprint-230` (feature — dynamic Postgres type list, Phase 27 sprint 5).
Date: 2026-05-07.
Status: Generator complete.

## §0 — TDD red→green sequence

`tdd-evidence/red-state.log` 캡처. 12 vitest case (`usePostgresTypes`)
+ 4 (`CreateTableTypeCombobox` Sprint 230 describe) + 3
(`CreateTableDialog` Sprint 230 describe) + 1 Rust unit test
(`list_types_sql_matches_canonical_fixture`) 모두 implementation 전에
작성. 그 후 backend (PG SQL const + 트레이트 메소드 + Tauri command)
+ frontend (hook + 콤보박스 prop + dialog 와이어링) 구현. 재실행 후
모두 green.

## §1 — 핵심 결정

### Cache layer = module-level memo (NOT zustand)

Contract Decisions §1 에 명시된 결정. 근거:

- 데이터 크기 작음 (~200-500 strings per connection). 크로스-윈도우 sync 불필요 — 각 윈도우가 독립적으로 fetch.
- zustand slice 추가는 `schemaStore.ts` body diff 필요 — Sprint 224 frozen invariant.
- module memo + `invalidatePostgresTypesCache(connectionId)` free function 으로 충분. Sprint 231 disconnect 와이어링이 단일 hook point 만 필요.
- React Test 격리는 `beforeEach` 에서 `invalidatePostgresTypesCache(connId)` 호출로 처리.

### Wrapper file location = `schema.ts` (NOT `ddl.ts`)

`listPostgresTypes` 는 read-only catalog query — `listSchemas` /
`listTables` / `getTableColumns` 와 동일한 paradigm. `ddl.ts` 는
mutation 전용 (`createTable`, `addConstraint`, `dropIndex` 등). 새
`types.ts` 도메인 파일을 만들 만한 명분이 없음 (1 wrapper). Barrel
`src/lib/tauri/index.ts` 가 이미 `./schema` 를 re-export 하므로 0-diff.

### `typesSource` prop default = `undefined` → canonical-list path

Sprint 227 carry-over 12 case 가 byte-for-byte 통과해야 함 (Invariant).
`typesSource` 를 `undefined` default 로 두고 useMemo branch 가 falsy
체크하면 콤보박스 기존 동작이 그대로 보존됨. `dialog` 가 hook 의
`pgTypes` 를 항상 prop 으로 전달하므로 dialog-instantiated 콤보박스는
dynamic 경로를 타고, 비-dialog 콤보박스 (없음) 또는 unit-test
controlled host 는 canonical-list 경로를 탐.

### Display label rule

Hook 내 helper `toLabel(info)`:

- `pg_catalog.<X>` → `<X>` (built-ins read naturally)
- `<other_schema>.<X>` → `<other_schema>.<X>` (qualification)
- empty name → `null` (defensive drop)
- `pg_toast` schema → `null` (defense-in-depth — 백엔드 SQL 이 이미 제외)

### PG SQL const location

`pub(crate) const LIST_TYPES_SQL: &str` 를 `src-tauri/src/db/postgres/schema.rs` 모듈 최상단에 둠. 런타임이 `sqlx::query_as(LIST_TYPES_SQL)` 로 실행하고, 단위 테스트 `list_types_sql_matches_canonical_fixture` 가 `assert_eq!` 로 byte-for-byte 검증. 어떤 미래 변경도 두 쪽을 함께 업데이트하지 않으면 `cargo test list_types` 가 실패함 — drift gate.

### `reload()` semantics

`invalidatePostgresTypesCache(connectionId)` → `fetchTypes(connectionId)` →
version bump immediately so consumers observe `loading=true` while the
refetch runs. Cached merged list (이전 success 결과) 는 그대로 노출
— silent replace UX (스피너 없음).

## §2 — 트레이드오프

### Module memo vs zustand slice

Module memo 의 단점:
- 테스트 격리에 `invalidatePostgresTypesCache` 명시 호출 필요 (`beforeEach`).
- React DevTools 에 store entry 가 없어서 디버깅 시 `console.log` 의존.
- 라이브 쿼리 hot-reload 시 모듈이 재초기화되어 캐시 휘발 — 사용자 영향 없음.

장점:
- `schemaStore.ts` 0-diff 유지.
- Sprint 231 disconnect 와이어링이 단일 hook point.
- 크로스-윈도우 sync 회피 (각 윈도우 독립 fetch — 필요한 경우 사용자가 재오픈).

채택: module memo. 데이터 크기 + 사용 패턴 (모달 안에서만 쓰임) 고려 시 zustand 의 reactive subscription / cross-window broadcast 가 필요 없음.

### Loading UX = canonical-instant + silent replace

Spinner 없는 이유:
- 사용자가 type cell 클릭 시 즉시 응답 기대.
- Spinner 가 깜빡이며 끔찍한 UX.
- Canonical list 가 95% 이상의 case 커버.
- Live extras 는 dropdown 끝에 silent 추가.

대안 (rejected):
- `Loader2` 아이콘 chevron 옆 → 사용자가 느린 인상 받음.
- Skeleton 행 → canonical 결과를 가림.

### `typesSource` prop 추가 vs hook 직접 호출

콤보박스가 hook 을 직접 호출하면 connectionId 를 prop 으로 받아야 함.
하지만 콤보박스는 connectionless context 에서도 사용 가능해야 함
(unit test controlled host 등). prop 으로 dynamic source 를 받는 쪽이
유연성 ↑ + back-compat 보장.

채택: prop. Dialog 가 hook 호출 → merged result 를 prop 으로 전달.

### `readonly string[]` vs `string[]`

`typesSource?: readonly string[]` 로 선언. `readonly` 는 콤보박스가
배열을 mutate 하지 않음을 정적으로 강제 (filter 만 수행). TypeScript
covariance 덕분에 호출자는 `string[]` 도 그대로 전달 가능 (no
breakage).

## §3 — 백엔드 결정

### `typtype IN ('b','d','e','r','c')` whitelist

Closed whitelist. PG `pg_type.typtype` 의 다른 값:

- `'p'` (pseudo) — `any`, `void`, `trigger` 등. 컬럼 type 으로 사용 불가.
- `'m'` (multirange, PG 14+) — 향후 sprint 에서 화이트리스트 확장 검토.

현재 sprint 는 `b`/`d`/`e`/`r`/`c` 로 충분 — 사용자가 컬럼 type 으로 선택할 수 있는 모든 paradigm 커버.

### Auto row type 제외

PG 가 모든 CREATE TABLE 에 대해 implicit composite type 을 생성 (`pg_type.typtype = 'c'`, `pg_type.oid` 가 `pg_class.reltype` 으로 참조됨). `NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)` 필터로 이런 자동 row type 만 제외하고, 사용자가 `CREATE TYPE … AS (…)` 로 만든 진짜 composite 만 surface.

### Array type 제외

`typname NOT LIKE '\_%' ESCAPE '\'`. PG 의 underscore-prefix 컨벤션 (`_int4`, `_varchar`, `_text`) 으로 array element type 을 식별. 베어 element name (`int4`, `varchar`, `text`) 은 같은 row 의 base type 으로 surface 됨. 사용자가 array 컬럼을 선언하려면 `int4[]` 같은 free-text 입력으로 가능.

### `pg_catalog` 포함

내장 type (`varchar`, `int4`, `uuid`) 이 `pg_catalog` 네임스페이스에 있음. SQL 에서 제외하지 않고, 프론트엔드 hook 에서 `pg_catalog.` prefix 를 strip 해서 자연스러운 라벨 생성. canonical list 와 정확히 일치하는 베어 이름이 dedup 되어 단일 entry 만 merged list 에 남음.

## §4 — Out of scope 확인

contract Out of Scope 항목 모두 본 sprint 미손대:

- Reorder ↑↓ buttons → Sprint 231.
- Table-level `COMMENT ON TABLE` → Sprint 231.
- Schema picker position move → Sprint 231.
- Type combobox color coding → Sprint 231 (`type_kind` 필드는 Sprint 230 이 surface 만, consumer 는 Sprint 231 에서 추가).
- Cross-tab visual feedback / empty column-name handling → Sprint 231.
- Auto-refresh on disconnect → Sprint 231 (free helper 만 export).
- DEFERRABLE / INITIALLY DEFERRED for FK → Sprint 232+.
- MySQL / MariaDB / SQLite / Oracle adapters → Phase 17+.
- Mongo path → 무관 (document paradigm).
- `useDdlPreviewExecution.ts` body 변경 0.
- `SqlPreviewDialog.tsx` body 변경 0.
- `schemaStore` / `connectionStore` body 변경 0.
- 새 `it.skip` / `eslint-disable` / `any` / silent `catch{}` 0.
- 새 shadcn primitive 0.

## §5 — Residual risks

- **Manual UI smoke 미수행** — `pnpm tauri dev` 환경 직접 확인 안 됨. e2e dead 로 자동화 불가.
- **Cache stale on disconnect** — `invalidatePostgresTypesCache(connectionId)` 가 export 되어 있지만 `connectionStore.disconnect` 에 wire 안 됨 (Sprint 224 freeze invariant). Sprint 231 폴리시 항목 (f).
- **Parent dialog `pgTypes` 참조 cycling** — `usePostgresTypes` 가 매 render 마다 `[...POSTGRES_COMMON_TYPES]` fallback 으로 새 배열 reference 를 반환할 수 있음. 콤보박스 `useMemo` 가 매 render 재계산. 비용은 negligible (filter over ≤ 500 strings) 이지만 향후 폴리시 가능.
- **No `reload` UI surface** — 훅이 `reload()` 노출하지만 dialog 에 버튼 없음. Sprint 231 (a) 에서 추가 가능.
- **`type_kind` 필드 미consumption** — Sprint 230 은 `PostgresTypeInfo` 의 `type_kind` 를 backend 에서 emit 하지만 frontend hook 은 라벨 string 만 노출. Sprint 231 type-coloring 이 raw list (또는 `Map<label, type_kind>`) 액세서를 추가해야 함.
- **PG SQL `\_` ESCAPE syntax** — PG 14+ 에서 검증. PG 12/13 환경은 검증 안 됨 (사용자 환경 PG 14+ 가정).

## §6 — 후속 입력 / 영속 표준

- 본 sprint = Phase 27 sprint 5. Sprint 231 (UX 종합 polish) 가 같은 dialog shell + `usePostgresTypes` hook 위에서 구축됨.
- `RdbAdapter::list_types` 트레이트 default `Unsupported` 패턴이 future Phase 17+ 어댑터의 dialect-specific 구현 합류 시 reference.
- Module-memo cache 패턴이 다른 read-only catalog query (e.g. extension list, role list) 에 재활용될 가능성 — 향후 두 번째 consumer 가 등장하면 generic `useCachedTauriQuery<T>` factory 추출 검토 (지금은 anticipatory abstraction risk 회피).
