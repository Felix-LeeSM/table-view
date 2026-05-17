# Sprint Contract: sprint-380

## Summary

- Goal: MySQL/SQLite sidebar 의 "Schemas" 헤더 라벨과 잉여 한 단계 들여쓰기를 제거.
  - MySQL 은 schema = database 동일 개념이라 "Schemas" 헤더가 어색.
  - SQLite 는 단일 파일 = 단일 schema 라 헤더도 들여쓰기도 어색.
  - PostgreSQL (with-schema) 은 현행 유지 (헤더 + 들여쓰기 그대로).
- Audience: 사용자 캡처 — MySQL 연결 시 "Schemas" 헤더와 categories 의 두 단계 들여쓰기가 정보 잉여로 느껴짐.
- Owner: Generator (sprint-380)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/components/schema/SchemaTree.tsx` — "Schemas" 헤더 label rendering 을 `treeShape === "with-schema"` 게이팅. Export/refresh 액션 버튼 row 는 모든 RDB 에서 유지.
- `src/components/schema/SchemaTree/rows.tsx` —
  - `SchemaTreeRowsContext` 에 `treeShape: RdbTreeShape` 추가.
  - Category row indent: `with-schema` → `pl-6` (현행), `no-schema` → `pl-3`.
  - Item row indent: `flat` → `pl-3` (현행), `no-schema` → `pl-7`, `with-schema` → `pl-10` (현행).
- `src/components/schema/SchemaTree/body.tsx` — `treeShape` 를 rows context 로 전달.
- 테스트: `src/components/schema/SchemaTree.mysql-naming.test.tsx` — 10 RTL.

## Out of Scope

- "Schemas" 헤더 label 의 i18n.
- PG `with-schema` 의 들여쓰기 / 라벨 변경.
- Export popover 의 "All schemas" / "Schemas" 내부 라벨 (popover 콘텐츠는 그대로 — RDB 모두 동일하게 schema-aware 한 export UI 가 들어있음).
- Mongo/Redis sidebar (`DocumentDatabaseTree` / `UnsupportedShell`) — paradigm 다름.
- SQLite category row 들여쓰기 — `flat` shape 은 애초에 category 를 렌더하지 않음 (변경 없음).

## Invariants

- 헤더 액션 버튼 (export popover trigger + refresh) 은 RDB 모두 노출 — 변경되는 것은 **literal "Schemas" 헤더 텍스트** 뿐.
- `flat` shape (SQLite) 은 category 자체가 없어 category indent 변화는 무관.
- `treeShape === "with-schema"` 인 경우 모든 들여쓰기 / 헤더 라벨이 현행과 동일 (PG 회귀 차단).

## Acceptance Criteria

- `AC-380-01` MySQL 연결 → sidebar 에 "Schemas" 라벨 (헤더 span 의 정확한 text "Schemas") **없음**.
- `AC-380-02` SQLite 연결 → "Schemas" 헤더 라벨 **없음**.
- `AC-380-03` MySQL 연결 → category row ("Tables in appdb") 가 `pl-3` 클래스를 가짐.
- `AC-380-04` SQLite 연결 → SQLite 는 category 가 없으므로 별도 보장 (item row `pl-3` 유지) — AC-380-02 와 함께 묶음.
- `AC-380-05` PG 연결 → "Schemas" 헤더 라벨 **있음** (정확히 text "Schemas").
- `AC-380-06` PG 연결 → category row 가 `pl-6` 클래스를 가짐.
- `AC-380-07` PG 연결 → schema row (예: "public schema") 가 정상 렌더.
- `AC-380-08` MySQL category row indent 클래스 (`pl-3`) ≠ PG category row indent 클래스 (`pl-6`) — 잉여 들여쓰기 제거 확인.
- `AC-380-09` MySQL 에서 4 categories (Tables, Views, Functions, Procedures) 모두 aria-label 로 reachable.
- `AC-380-10` MySQL item row (table) 가 `pl-7` 클래스를 가짐 (3-way indent: PG `pl-10` / MySQL `pl-7` / SQLite `pl-3`).

## Design Bar / Quality Bar

- TDD: 10 RTL 시나리오 먼저 빨강 → 각 AC 별 한 번에 하나씩 RED → GREEN.
- `getByRole`/`queryByText` 우선, `getByTestId` 는 last resort.
- 신규 테스트 파일 ≥ 70% lines coverage.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/schema/SchemaTree.mysql-naming.test`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`

### Required Evidence

- 10 RTL test name + 결과.
- PG 회귀 차단 — 기존 SchemaTree 테스트 모두 유지.

## Risk

- `SchemaTreeRowsContext` 시그니처 변경 → 다른 곳에서 동일 context 를 만드는 코드가 있다면 깨질 수 있음. 검사 후 영향 범위 좁은지 확인.
- 클래스 문자열 단언 → Tailwind 클래스 이름 그대로 — refactor 시 깨질 수 있으나 indent 의도가 클래스 텍스트로 노출되어 있으므로 우리가 변경하는 클래스만 단언.
