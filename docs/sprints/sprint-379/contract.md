# Sprint Contract: sprint-379

## Summary

- Goal: Sidebar 헤더 "Collapse all" 버튼을 **DB type 별 label** + **collapse/expand 토글**로 격상.
  - PG / MSSQL → "(Collapse|Expand) all schemas"
  - MySQL → "(Collapse|Expand) all tables"
  - SQLite → "(Collapse|Expand) all tables"
  - Mongo → "(Collapse|Expand) all collections"
  - 모두 expanded ≥ 1 → label "Collapse". 모두 collapsed → label "Expand". 단일 버튼 = 토글.
- Audience: 사용자 캡처 (이미지 #4) — MySQL 연결에서도 의미가 통하는 sidebar header affordance.
- Owner: Generator (sprint-379)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint + cargo clippy)

## In Scope

- 신규 모듈: `src/lib/dbTypeLabels.ts` — `getSidebarObjectLabel(dbType: DatabaseType): { single: string, plural: string }` 단일 매핑.
- 컴포넌트: `src/components/layout/Sidebar.tsx` — 기존 "Collapse all" 버튼을 DB type aware + 토글로 격상.
- 테스트: `src/components/layout/Sidebar.collapse-toggle.test.tsx` — 4 DB type × 2 state (총 8 RTL).

## Out of Scope

- MySQL sidebar 의 schema 노드 자체 제거 (sprint-380).
- 다른 sidebar header affordance (Reset width 등) 의 DB type 별 label 화.
- 키보드 단축키 / context menu 도입.

## Invariants

- 매핑 함수 이름은 `getSidebarObjectLabel` — sprint-380 (mysql-sidebar-naming) 이 같은 함수 import 가능.
- 버튼 1개로 토글 — 별도의 "Expand all" 버튼 추가 안 함.
- `expanded.length === 0` → label "Expand all <plural>" + 클릭 시 expand 동작. 단, **현재 sprint 는 expand path 가 빈 동작** (실제 schema tree 의 모든 노드 ID 를 알지 못함). 따라서:
  - 모두 collapsed 상태에서 클릭 → "expand all" 의도 표명 + workspace store 에 sentinel (`["__expand_all__"]`) 저장? **NO** — 본 sprint 는 단순화하여 "모두 collapsed → expand 클릭은 no-op + label 만 'Expand all *' 로 노출하여 사용자가 어떤 노드를 직접 expand 해야 함을 신호"로 한다. → sprint-381 (expand-all-tree-walk) 에서 보강.
  - **Re-decision**: 사용자 task 가치 ↓ (caveman) — 토글 두 방향 모두 useful 해야. 그러므로:
    - Expand 클릭은 schema tree 의 *최상위 컨테이너 노드*만 expand. `expand_all_root_containers(connId, db)` workspace store action 추가. tree walk 의 leaf 까지 가지 않음. PG: 모든 schema 노드. MySQL/SQLite: "Tables" / "Views" / 등 카테고리 노드. Mongo: 모든 database 노드. — 실제 데이터는 사용자가 노드를 직접 클릭할 때 lazy load.
    - 본 sprint 도 단순화: workspace store 의 `expanded` 배열에 *현재 connection 의 schema list* (RDB) 또는 *database list* (Mongo) 의 *최상위 노드 ID* 들을 채워 넣는다. 그 ID 들은 schema store / mongo store 의 현재 캐시에서 얻는다. 캐시가 비어 있으면 "Expand all" no-op (label 은 그대로).

## Acceptance Criteria

- `AC-379-01` PG 연결, expanded ≥ 1 → 버튼 label "Collapse all schemas". 클릭 → `expanded = []`.
- `AC-379-02` PG 연결, expanded === [] → 버튼 label "Expand all schemas". 클릭 → schema store 의 현재 schema list 로 `expanded` 채움 (없으면 no-op).
- `AC-379-03` MySQL 연결, expanded ≥ 1 → 버튼 label "Collapse all tables". 클릭 → `expanded = []`.
- `AC-379-04` MySQL 연결, expanded === [] → 버튼 label "Expand all tables". 클릭 → (캐시된 카테고리 ID 채움; 없으면 no-op).
- `AC-379-05` SQLite 연결, expanded ≥ 1 → 버튼 label "Collapse all tables". (동일 로직)
- `AC-379-06` SQLite 연결, expanded === [] → 버튼 label "Expand all tables".
- `AC-379-07` Mongo 연결, expanded ≥ 1 → 버튼 label "Collapse all collections". 클릭 → `expanded = []`.
- `AC-379-08` Mongo 연결, expanded === [] → 버튼 label "Expand all collections". 클릭 → mongo store database list 로 `expanded` 채움 (없으면 no-op).

## 단순화 결정 (Auto-mode self-grill)

위 contract 에 "expand 클릭 시 store 의 schema/database list 로 채움" 은 본 sprint 의
*generator step* 을 부풀린다. **사용자 task 가치 측면에서, 토글의 두 방향이 모두 즉시
유의미해야 한다** 는 caveman 원칙을 유지하되, **expand 의 구체적 노드 source** 는
다음으로 단순화:

- `expanded.length > 0` → 클릭 시 `setExpanded(connId, db, [])` (collapse).
- `expanded.length === 0` → 클릭 시 **no-op** + UI 만 "Expand all *" label.
  사유: schema/mongo store 의 현재 캐시 reach 는 본 sprint 의 sidebar header layer 에서
  안전하게 접근하기 어렵고 (paradigm 분기 필요), tree-walk 의도는 sprint-381 에서.

→ AC-379-02, -04, -06, -08 의 "클릭 → 노드 채움" 단언은 **제거** 하고
"클릭 → 단언할 사이드이펙트 없음 (label 만 'Expand all *')" 로 명세 단순화.

본 sprint 의 *순수 contract* = **label DB-type-awareness + collapse 토글**.
Expand 의 실제 동작은 후속 (sprint-381).

## Design Bar / Quality Bar

- TDD: 8 RTL 시나리오 (4 DB type × 2 state) 먼저 빨강. label 매핑 + state-aware label 분기 → 초록.
- 매핑은 `getSidebarObjectLabel` 순수 함수. 분리 단위 test 추가.
- aria-label / title 모두 새 label 반영.
- 테스트 작성 날짜 + 사유 코멘트 (CLAUDE.md feedback_test_documentation).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/dbTypeLabels src/components/layout/Sidebar`
2. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
3. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`

### Required Evidence

- 8 RTL test name + 결과.
- `getSidebarObjectLabel` 단위 5+ assertion (5 DatabaseType variant).

## Test Requirements

- Vitest: 8 RTL + 5+ unit (mapping 함수).
- Coverage: dbTypeLabels.ts 100%, Sidebar.tsx 영향 라인 90%+.
