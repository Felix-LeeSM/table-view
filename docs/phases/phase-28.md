# Phase 28: MongoDB Full Support

> **상태: historical planning inventory (2026-05-22 re-baseline).** 이 문서는
> MongoDB full-support 의 방향과 slice label 을 보존하는 context 이며, 현재 제품의
> 지원 범위나 active sprint queue 의 SOT 가 아니다. 현재 MongoDB support claim 은
> `docs/product/README.md` 와 `docs/product/known-limitations.md` 가 소유하고,
> 검증 범위는 `docs/contributor-guide/testing-and-quality.md` 가, 미래의 work
> routing 은 `docs/ROADMAP.md` 와 open issue 가 소유한다. 2026-05-14 grill 결정은
> 그대로 유지하되, Sprint 420–430 의 language completion architecture 와 ADR 0045
> 이후의 기준으로 Slice A 를 재정렬했다. 이 Phase 의 grill 결정 dict 는
> [`docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md`](../../docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md)
> 에 동결되어 있다. RDB+Mongo paradigm 통합 후속 묶음 (U1–U5) 은 별도의 phase
> 후보이고, 그 내용은
> [`docs/archives/roadmaps/memory-roadmap/unified-followups/memory.md`](../../docs/archives/roadmaps/memory-roadmap/unified-followups/memory.md)
> 에 있다.

## Historical 2026-05-22 Re-baseline

아래 항목은 당시의 planning baseline 이다. 구현 여부나 현재 support claim 을
판단할 때는 product/contributor docs 와 live issue state 를 먼저 본다.

- Rust/WASM completion SOT 는 이미 있다:
  `src-tauri/mongosh-parser-core/src/completion.rs`.
- TypeScript Mongo completion vocabulary 는 WASM 을 load 하기 전의 fallback
  mirror 로만 유지한다.
- 자동완성 architecture 의 SOT 는 ADR 0045 와
  `docs/product/query-language-support.md` 다.
- Slice A 는 greenfield external parser 를 도입하는 작업이 아니다. 기존 Rust/WASM
  parser/completion core 를 Query Editor routing 에 연결하는 작업이다.
- 임의의 JavaScript execution 은 계속 금지한다. 지원 method whitelist 와 typed
  dispatch 만 확장한다.

## 배경

기존의 Mongo 지원은 Phase 6 과 Sprint 189–198 에서 만든 부분 구현이었다 (filter
bar 5 operators, find/aggregate toggle 의 raw JSON 만 받는 입력, $set 단독
update, schema-less DataGrid 의 기본 표시). TablePlus 패리티 작업이 끝난 뒤에
사용자가 "MongoDB 기능 full 로 지원" 을 요청했고, 2026-05-14 grill 세션에서
카테고리 20개 이상의 결정을 lock 했다.

판단 기준은 "PostgreSQL 워크플로우 (탐색 / 조회 / 편집 / 쿼리 / 운영) 를
MongoDB 연결에서도 끊김 없이 반복할 수 있는가" 이다. 다만 paradigm 의 차이는
받아들인다 (BSON nested 편집은 paradigm-specific UX 다).

## 범위

### 데이터 / 편집 surface

- **DataGrid Filter Bar**: Q7 에서 정한 13 operators 를 빈도순으로 놓는다
  (`$eq $ne $gt $gte $lt $lte $in $nin $exists $regex $or $and $not`).
- **Sort**: Q8 의 multi-column 정렬과 column header context menu 를 쓴다 (RDB 와
  통합한다).
- **Hide column**: Q9 와 Q10 의 hybrid trigger 와 상단 배지를 쓰고,
  (connId,db,coll) 를 키로 persist 한다.
- **Nested 편집**: Q19 의 옵션 D 를 따르고, 컬럼 헤더의 `⋯` 버튼으로 1-depth 를
  expand 한다. promoted cell 의 편집은 `$set: {"<path>": value}` 형태의
  dot-notation mutation 이다. QuickLook 과 pendingEdits 를 공유한다.
- **BSON type editor**: Q20 의 ObjectId (생성기) 와 ISODate (datetime picker
  이고 RDB TIMESTAMP 와 컴포넌트를 공유한다), Decimal128, BinData 를 다룬다.
  나머지 타입은 raw 로 둔다.
- **Field projection**: Q21 에 따라 filter bar 옆에 `Fields ▾` 다이얼로그를 둔다
  (include/exclude). toolbar 에는 `Fields: N/total` chip 을 띄운다.
- **Bulk write + transaction toggle**: Q4 에 따라 default 는 ON 이고,
  per-connection 으로 persist 한다.
- **Update operator**: Q5 에 따라 DataGrid 는 `$set` 만 쓰고 QuickLook 은
  advanced 까지 쓴다 (`$inc/$push/$pull/$unset`). pendingEdits 의 shape 은
  `{value, operator}` 다.
- **`_id` 차단**: Q6 에 따라 disabled 로 두고 tooltip 을 붙인다.
- **Pagination count**: Q11 에 따라 항상 정확한 값을 낸다 (`countDocuments`).
- **Schema accumulator**: Q12 에 따라 client-side 로 누적하고 `—` 를 placeholder
  로 쓴다. 컬럼 순서는 `_id` first → 발견순 → 알파벳순이고, Drop key cell action
  (`$unset`) 을 두며, width 는 name-keyed 다.
- **Type display**: Q13 에 따라 QuickLook 에서만 per-field BSON type label 을
  보여준다.

### Sidebar / Structure surface

- **Sidebar 노드 구조**: collection 당 Collections + Views + Indexes 3 노드를
  둔다.
- **Validator slot**: StructurePanel 의 Constraints 탭에서 paradigm 으로 분기해
  Mongo 의 `$jsonSchema` validator 를 노출한다.
- **Indexes 탭 (Mongo)**: `$indexStats` 컬럼 (Ops / Since) 을 추가해서 쓰이지
  않는 index 를 식별한다 (Q16).
- **Views**: list 와 create form, drop 을 제공한다. RDB Views 사이드바와 + 버튼을
  통합하고, paradigm 으로 분기해 form 만 다르게 한다 (Q17).

### Query 입력 surface

- **Unified mongosh editor**: Find/Aggregate toggle 을 제거하고
  `db.coll.method(args)` 를 입력받는다. routing 은 기존 Rust/WASM mongosh
  parser/completion core 에 기반하며, JS eval 은 쓰지 않는다. toolbar 에는
  `+ Insert ▾` dropdown 을 4 section (Methods / Mutations / Operators / Stages)
  으로 둔다.
- **지원 method**: find, findOne, aggregate, countDocuments,
  estimatedDocumentCount, distinct, insertOne, insertMany, updateOne,
  updateMany, deleteOne, deleteMany, bulkWrite 와 cursor chain
  (`.limit/.skip/.sort/.toArray`) 을 지원한다.

### DDL surface

- **Collection**: create form (Type radio 는 Standard / Capped / Time-series
  이고 조건부 옵션이 붙는다) 과 rename, drop 을 제공한다 (Q18 의 옵션 C).
- **Database**: 명시적인 create wrapper (이름과 첫 collection 을 받는다) 와 drop
  confirmation modal 을 둔다 (Q18 의 옵션 C).

## Out of Scope

- **Q22 Sample preview**: DataGrid 와 StructurePanel, `findOne` 으로 커버한다.
- **Q23 Change streams**: `watch()` 는 Query Editor 에서 raw 로 호출한다.
- **Q25 Multi-doc transaction**: `session.startTransaction()` 은 Query
  Editor 에서 raw 로 호출한다.
- **Q33 Backup / Restore**: `mongodump` 와 `mongorestore` 가 맡는 CLI 영역이다.
- **Q34 GridFS**: 사용자 base 가 좁다. `fs.files` metadata 는 일반
  DataGrid 로 노출된다.
- **Q30 User / Role management, Q31 Auth mechanism 추가 옵션**:
  threat-model 핸드오프를 거친 뒤에 별도로 grill 한다. 이 phase 가 끝난 뒤의
  보안 phase 후보다.
- **U1–U5 RDB+Mongo 통합 후속**: 별도의 phase 로 다루며, `unified-followups`
  메모리가 소유한다.

## Slice 분해 (historical)

이 표는 active sprint sequence 가 아니다. 새 작업은 `docs/ROADMAP.md` 의
승격 게이트와 open issue 로 다시 scope 를 잡는다.

전체 13 slice 이고, 각 slice 가 1 sprint 단위다.

| Slice | 범위 | 핵심 |
|-------|------|------|
| **A** | Unified mongosh editor (Q14+15+Find) | toggle 을 제거하고, existing Rust/WASM parser/completion routing 과 `+ Insert ▾` dropdown 을 붙인다. **architectural shift 라서 가장 먼저 한다** |
| **B** | DataGrid Filter Bar 13 operators (Q7) | RDB Filter Bar 와 layout 을 공유한다 |
| **C** | Sort multi-column + context menu (Q8) | RDB 와 Mongo 를 통합한다 |
| **D** | Hide column hybrid (Q9+Q10) | per-collection 으로 persist 하고 store slice 를 만든다 |
| **E** | Schema accumulator (Q12) | client-side 에서 fetch result 를 누적한다 |
| **F** | Nested editing: `⋯` 로 1-depth 를 expand 한다 (Q19) | Q12 의 schema 를 재사용하고 dot-notation `$set` mutation 을 쓴다 |
| **G** | BSON type editor (Q20) | ObjectId/ISODate/Decimal128/BinData 전용 editor 를 만들고, ISODate 는 RDB TIMESTAMP 와 컴포넌트를 공유한다 |
| **H** | Field projection (Q21) | filter bar 옆의 다이얼로그와 query 옵션을 다룬다 |
| **I** | bulkWrite + transaction toggle (Q4) + `_id` 차단 (Q6) + `$set`/advanced operator (Q5) | DataGrid 의 Commit 흐름을 다룬다 |
| **J** | Indexes 탭 + `$indexStats` (Q16) | StructurePanel 의 tab 이다 |
| **K** | Validator slot (Q-Validator) + Views (Q17, RDB 통합 + 버튼) | StructurePanel 과 사이드바, + 버튼을 다룬다 |
| **L** | Collection DDL: create (capped/timeseries) 와 rename, drop (Q18) | StructurePanel 과 사이드바를 다룬다 |
| **M** | DB create wrapper + drop confirmation (Q18) | 사이드바를 다룬다 |

선후관계는 다음과 같다.

- A 를 먼저 한다 (Query Editor 의 구조를 바꾸고, 다른 slice 의 parser/routing 이
  여기에 의존한다).
- E 를 F 보다 먼저 한다 (schema 가 nested expand 의 입력이다).
- B 와 C 는 RDB 와 paradigm 을 통합하므로 별도의 RDB 수정도 함께 한다.
- G 의 ISODate picker 는 RDB TIMESTAMP cell editor 의 component-extract 가
  선행해야 한다.

### Slice A 내부 순서

| Sub-slice | 목적 |
|---|---|
| **A1** | Find/Aggregate toggle 제거를 준비한다: editor mode/routing boundary 를 Rust/WASM parse result 로 바꾼다. UI toggle 은 feature flag/compat path 로 유지한다. |
| **A2** | Supported method whitelist 와 typed dispatch 를 `find/findOne/aggregate/countDocuments/distinct` 중심으로 통합한다. |
| **A3** | Mutation methods (`insert*`, `update*`, `delete*`, `bulkWrite`) routing 을 Safe Mode / confirmation flow 와 연결한다. |
| **A4** | `+ Insert ▾` dropdown 을 Rust/WASM vocabulary groups 에서 생성한다. TS constant 는 fallback mirror 만 허용한다. |
| **A5** | Toggle 을 제거하고 legacy tests 를 정리하며, Phase 28 의 B 로 진입하는 gate 를 세운다. |

## Acceptance Criteria

- **AC-28-01** Unified mongosh editor 가 `db.coll.method(args)` 패턴을
  지원하고 13+ method 를 받으며, Find/Aggregate toggle 을 제거한 뒤에는
  Rust/WASM parser result 가 자동으로 분기한다.
- **AC-28-02** DataGrid Filter Bar 의 13 operators 가 모두 동작한다 (RDB filter
  와 layout 을 통일한다).
- **AC-28-03** Multi-column sort 를 header context menu 로 제공한다 (RDB 도
  동시에 patch 한다).
- **AC-28-04** Nested `⋯` 로 1-depth 를 expand 하고 → cell 을 더블클릭하면 →
  `$set: {"<path>": value}` 로 commit 한다. QuickLook 과 pending 을 공유한다.
- **AC-28-05** BSON type editor 4종 (ObjectId/ISODate/Decimal128/
  BinData) 을 제공한다. ISODate picker 는 RDB TIMESTAMP 와 component 를
  공유한다.
- **AC-28-06** Field projection 을 활성화하면 transport 에서 그 필드를 제외한다
  (네트워크로 검증한다).
- **AC-28-07** DataGrid commit 은 bulkWrite + transaction toggle 이 ON 인
  경우와 OFF 인 경우 모두 동작하고, `_id` 를 수정하려는 시도는 disabled 로 막는다.
- **AC-28-08** Indexes 탭에서 Ops / Since 컬럼을 정렬할 수 있고, 값이 0 인
  index 는 빨강으로 highlight 한다.
- **AC-28-09** Views 의 사이드바 + 버튼이 RDB 와 같은 위치에서 같게 동작한다
  (form 만 paradigm 으로 분기한다).
- **AC-28-10** Collection create form 에서 Standard / Capped / Time-series
  radio 3 type 을 모두 생성할 수 있다. Drop 과 Rename 도 동작한다.
- **AC-28-11** DB create wrapper (이름과 첫 collection 을 받는다) 와 DB drop
  confirmation (이름을 다시 입력하게 한다) 을 제공한다.
- **AC-28-12** RDB 의 모든 회귀가 green 이다. paradigm 통합 (B, C, G, K) 이 RDB
  영역을 깨뜨리지 않는다.

## TDD 정책

- Slice A 의 Rust/WASM parser routing 은 Rust 단위 테스트와 React parser
  wrapper 테스트로 덮는다.
  파서가 11 method × 표준 인자 형태를 빠짐없이 추출해야 한다.
- 각 slice 는 표준 RED → GREEN 순서를 따르고, UI 변경은 RTL 단위 테스트로 덮는다.
- Mongo backend 는 기존 `MongoAdapter` 의 단위 테스트와 integration
  (testcontainers) 테스트로 코어 method 를 모두 커버한다.

## E2E 시나리오 (안)

| ID | 시나리오 |
|----|---------|
| E28-01 | mongosh editor 에 `db.users.find({age:{$gt:30}}).limit(10)` → 결과 grid |
| E28-02 | DataGrid Filter Bar 의 `$regex` 입력 → server-side filter |
| E28-03 | Sort 두 컬럼 (이름 ASC + age DESC) → header context menu |
| E28-04 | `address.city` 컬럼을 ⋯ 클릭으로 promote → city 컬럼 정렬 → cell edit → Commit → `$set: {"address.city": ...}` 검증 |
| E28-05 | ObjectId 컬럼의 "Generate" 버튼 → 새 doc insert |
| E28-06 | Field projection 에서 `password` 제외 → `password` 컬럼 안 보임 + 네트워크 페이로드에서 제외 |
| E28-07 | DataGrid 3 row 동시 변경 → Commit (transaction toggle ON) → 한 doc fail 시 전체 rollback |
| E28-08 | Indexes 탭에서 Ops = 0 인 index drop |
| E28-09 | View create 에서 pipeline 입력 → 사이드바에 view 노출 → 클릭 시 결과 grid |
| E28-10 | Capped collection 만들기 (Type=Capped, size=100MB) → 사이드바 노출 |
| E28-11 | DB drop confirmation 에서 잘못 입력 → block, 정확히 입력 → drop |
| E28-12 | PG 와 Mongo 두 connection 동시 열기 → tab 의 paradigm 분리, 한 쪽 결정이 다른 쪽 영향 없음 |

## 위험 / 미정

- **R28.1** parser/completion SOT 는 Rust/WASM 으로 이미 정리되었지만, Query
  Editor 의 dispatch path 에는 아직 legacy toggle 이나 TS wrapper 에 대한 의존이
  남아 있을 수 있다. Slice A1 에서 boundary 를 audit 한다.
- **R28.2** ISODate picker 가 RDB TIMESTAMP 컴포넌트를 공유하려면, 현재 RDB 의
  TIMESTAMP cell editor 가 별도 컴포넌트로 분리되어 있는지 먼저 확인해야 한다.
  분리되어 있지 않으면 분리 작업을 선행한다.
- **R28.3** `+ Insert ▾` dropdown 의 4 section 이 toolbar 의 폭을 압박할 수
  있으므로, collapsed 라벨 디자인이 필요하다.
- **R28.4** transaction 을 지원하지 않는 환경 (standalone Mongo) 에서 toggle 을
  ON 으로 두었을 때 실패 메시지가 얼마나 친절한지 살펴야 한다.

## Phase Exit Gate

- Skip-zero 를 지키고 AC-28-01..12 를 잠근다.
- RDB paradigm 통합 (B, C, G, K) 에서 RDB 회귀가 0 이다.
- E28 suite 가 green 이다.
- 보안 영역 (Q30, Q31) 의 별도 threat-model 핸드오프 일정을 확정한다. 이 phase 가
  끝나는 시점에 Phase 29 (보안) 와 Unified Followups phase 의 진입 순서를 정한다.

## Demo / 산출물

이 phase 의 grill 을 진행하면서 쓴 HTML mock 시리즈는 결정을 lock 한 뒤에
폐기했다.
