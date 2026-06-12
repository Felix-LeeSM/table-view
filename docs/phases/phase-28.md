# Phase 28: MongoDB Full Support

> **상태: historical planning inventory (2026-05-22 re-baseline).** 이 문서는
> MongoDB full-support 방향과 slice label 을 보존하는 context 이며, 현재 제품
> 지원 범위나 active sprint queue 의 SOT 가 아니다. 현재 MongoDB support claim 은
> `docs/product/README.md` 와 `docs/product/known-limitations.md`, 검증 범위는
> `docs/contributor-guide/testing-and-quality.md`, 미래 work routing 은
> `docs/ROADMAP.md` 와 open issue 가 소유한다. 2026-05-14 grill 결정은 유지하되,
> Sprint 420–430 의 language completion architecture 와 ADR 0045 이후 기준으로
> Slice A 를 재정렬했다. 본 Phase 의 grill 결정 dict 는
> [`docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md`](../../docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md)
> 에 동결. RDB+Mongo paradigm 통합 후속 묶음 (U1–U5) 은 별도 phase 후보 —
> [`docs/archives/roadmaps/memory-roadmap/unified-followups/memory.md`](../../docs/archives/roadmaps/memory-roadmap/unified-followups/memory.md).

## Historical 2026-05-22 Re-baseline

아래 항목은 당시 planning baseline 이다. 구현 여부나 현재 support claim 을 판단할
때는 product/contributor docs 와 live issue state 를 먼저 본다.

- Rust/WASM completion SOT 는 이미 있다:
  `src-tauri/mongosh-parser-core/src/completion.rs`.
- TypeScript Mongo completion vocabulary 는 WASM load 전 fallback mirror 로만
  유지한다.
- 자동완성 architecture SOT 는 ADR 0045 +
  `docs/product/query-language-support.md`.
- Slice A 는 greenfield external parser 도입이 아니다. 기존 Rust/WASM
  parser/completion core 를 Query Editor routing 에 연결하는 작업이다.
- 임의 JavaScript execution 은 계속 금지한다. 지원 method whitelist 와 typed
  dispatch 만 확장한다.

## 배경

기존 Mongo 지원은 Phase 6 / Sprint 189–198 의 부분 구현 (filter bar 5
operators, find/aggregate toggle 의 raw JSON 만, $set 단독 update,
schema-less DataGrid 의 기본 표시). TablePlus 패리티 종료 후 사용자가
"MongoDB 기능 full 로 지원" 을 요청. 2026-05-14 grill 세션으로 카테고리
20+ 결정을 lock.

판단 기준: "PostgreSQL 워크플로우 (탐색 / 조회 / 편집 / 쿼리 / 운영) 를
MongoDB 연결에서도 끊김 없이 반복할 수 있는가" — 단, paradigm 차이는
받아들임 (BSON nested 편집은 paradigm-specific UX).

## 범위

### 데이터 / 편집 surface

- **DataGrid Filter Bar** — Q7 13 operators 빈도순 (`$eq $ne $gt $gte $lt
  $lte $in $nin $exists $regex $or $and $not`).
- **Sort** — Q8 multi-column + column header context menu (RDB 와 통합).
- **Hide column** — Q9+Q10 hybrid trigger + 상단 배지 + (connId,db,coll)
  persist.
- **Nested 편집** — Q19 옵션 D + 컬럼 헤더 `⋯` 버튼 1-depth expand.
  promoted cell 편집은 `$set: {"<path>": value}` dot-notation mutation.
  QuickLook 과 pendingEdits 공유.
- **BSON type editor** — Q20 ObjectId (생성기) / ISODate (datetime picker
  — RDB TIMESTAMP 공유 컴포넌트) / Decimal128 / BinData. 나머지 raw.
- **Field projection** — Q21 filter bar 옆 `Fields ▾` 다이얼로그
  (include/exclude). toolbar 에 `Fields: N/total` chip.
- **Bulk write + transaction toggle** — Q4 default ON, per-connection
  persist.
- **Update operator** — Q5 DataGrid `$set` only / QuickLook advanced
  (`$inc/$push/$pull/$unset`). pendingEdits shape `{value, operator}`.
- **`_id` 차단** — Q6 disabled + tooltip.
- **Pagination count** — Q11 항상 정확 (`countDocuments`).
- **Schema accumulator** — Q12 client-side, `—` placeholder, `_id` first
  → 발견순 → 알파벳, Drop key cell action (`$unset`), width name-keyed.
- **Type display** — Q13 QuickLook 에서만 per-field BSON type label.

### Sidebar / Structure surface

- **Sidebar 노드 구조** — Collections + Views + Indexes 3 노드 per
  collection.
- **Validator slot** — StructurePanel 의 Constraints 탭에 paradigm 분기로
  Mongo `$jsonSchema` validator 노출.
- **Indexes 탭 (Mongo)** — `$indexStats` 컬럼 (Ops / Since) 추가. 안 쓰는
  index 식별 (Q16).
- **Views** — list / create form / drop. RDB Views 사이드바와 + 버튼
  통합 (paradigm 분기로 form 만 다름, Q17).

### Query 입력 surface

- **Unified mongosh editor** — Find/Aggregate toggle 제거.
  `db.coll.method(args)` 입력. 기존 Rust/WASM mongosh parser/completion core
  기반 routing. JS eval 없음. toolbar 에 `+ Insert ▾` dropdown 4 section
  (Methods / Mutations / Operators / Stages).
- **지원 method** — find, findOne, aggregate, countDocuments,
  estimatedDocumentCount, distinct, insertOne, insertMany, updateOne,
  updateMany, deleteOne, deleteMany, bulkWrite + cursor chain
  (`.limit/.skip/.sort/.toArray`).

### DDL surface

- **Collection** — create form (Type radio: Standard / Capped /
  Time-series + 조건부 옵션) / rename / drop (Q18 옵션 C).
- **Database** — 명시 create wrapper (이름 + 첫 collection) / drop
  confirmation modal (Q18 옵션 C).

## Out of Scope

- **Q22 Sample preview** — DataGrid + StructurePanel + `findOne` 으로 커버.
- **Q23 Change streams** — `watch()` 는 Query Editor 에서 raw 호출.
- **Q25 Multi-doc transaction** — `session.startTransaction()` 은 Query
  Editor 에서 raw 호출.
- **Q33 Backup / Restore** — `mongodump`/`mongorestore` CLI 영역.
- **Q34 GridFS** — 사용자 base 좁음. `fs.files` metadata 는 일반
  DataGrid 로 노출됨.
- **Q30 User / Role management, Q31 Auth mechanism 추가 옵션** —
  threat-model 핸드오프 후 별도 grill. 본 phase 종료 후 보안 phase 후보.
- **U1–U5 RDB+Mongo 통합 후속** — 별도 phase. `unified-followups`
  메모리.

## Slice 분해 (historical)

이 표는 active sprint sequence 가 아니다. 새 작업은 `docs/ROADMAP.md` 의
승격 게이트와 open issue 로 다시 scope 를 잡는다.

13 slice. 각 slice 가 1 sprint 단위.

| Slice | 범위 | 핵심 |
|-------|------|------|
| **A** | Unified mongosh editor (Q14+15+Find) | toggle 제거, existing Rust/WASM parser/completion routing, `+ Insert ▾` dropdown. **architectural shift — 가장 먼저** |
| **B** | DataGrid Filter Bar 13 operators (Q7) | RDB Filter Bar 와 layout 공유 |
| **C** | Sort multi-column + context menu (Q8) | RDB+Mongo 통합 |
| **D** | Hide column hybrid (Q9+Q10) | per-collection persist, store slice |
| **E** | Schema accumulator (Q12) | client-side fetch result 누적 |
| **F** | Nested editing — `⋯` 1-depth expand (Q19) | Q12 schema 재사용, dot-notation `$set` mutation |
| **G** | BSON type editor (Q20) | ObjectId/ISODate/Decimal128/BinData 전용 editor, ISODate 는 RDB TIMESTAMP 와 컴포넌트 공유 |
| **H** | Field projection (Q21) | filter bar 옆 다이얼로그, query 옵션 |
| **I** | bulkWrite + transaction toggle (Q4) + `_id` 차단 (Q6) + `$set`/advanced operator (Q5) | DataGrid Commit 흐름 |
| **J** | Indexes 탭 + `$indexStats` (Q16) | StructurePanel tab |
| **K** | Validator slot (Q-Validator) + Views (Q17, RDB 통합 + 버튼) | StructurePanel + 사이드바 + 버튼 |
| **L** | Collection DDL — create (capped/timeseries) / rename / drop (Q18) | StructurePanel + 사이드바 |
| **M** | DB create wrapper + drop confirmation (Q18) | 사이드바 |

선후관계:
- A 가 먼저 (Query Editor 구조 변경, 다른 slice 의 parser/routing 의존).
- E 가 F 전에 (schema 가 nested expand 의 입력).
- B 와 C 는 RDB 와 paradigm 통합이라 별도 RDB 수정도 같이.
- G 의 ISODate picker 는 RDB TIMESTAMP cell editor 의 component-extract 가 선행.

### Slice A 내부 순서

| Sub-slice | 목적 |
|---|---|
| **A1** | Find/Aggregate toggle 제거 준비: editor mode/routing boundary 를 Rust/WASM parse result 로 바꾼다. UI toggle 은 feature flag/compat path 로 유지. |
| **A2** | Supported method whitelist 와 typed dispatch 를 `find/findOne/aggregate/countDocuments/distinct` 중심으로 통합한다. |
| **A3** | Mutation methods (`insert*`, `update*`, `delete*`, `bulkWrite`) routing 을 Safe Mode / confirmation flow 와 연결한다. |
| **A4** | `+ Insert ▾` dropdown 을 Rust/WASM vocabulary groups 에서 생성한다. TS constant 는 fallback mirror 만 허용한다. |
| **A5** | Toggle 제거 + legacy tests 정리 + Phase 28 B 진입 gate. |

## Acceptance Criteria

- **AC-28-01** Unified mongosh editor — `db.coll.method(args)` 패턴
  지원, 13+ method, Rust/WASM parser result 가 Find/Aggregate toggle 제거
  후 자동 분기.
- **AC-28-02** DataGrid Filter Bar 13 operators 모두 동작 (RDB filter
  와 layout 통일).
- **AC-28-03** Multi-column sort — header context menu (RDB 동시
  patch).
- **AC-28-04** Nested `⋯` 1-depth expand → cell 더블클릭 → `$set:
  {"<path>": value}` commit. QuickLook 과 pending 공유.
- **AC-28-05** BSON type editor 4종 (ObjectId/ISODate/Decimal128/
  BinData). ISODate picker 가 RDB TIMESTAMP 와 component 공유.
- **AC-28-06** Field projection — 활성 시 transport 에서 제외 (네트워크
  검증).
- **AC-28-07** DataGrid commit — bulkWrite + transaction toggle ON /
  OFF 둘 다, `_id` 수정 시도는 disabled.
- **AC-28-08** Indexes 탭 — Ops / Since 컬럼 정렬 가능, 0 인 index 빨강
  highlight.
- **AC-28-09** Views — 사이드바 + 버튼이 RDB 와 동일 위치 / 행동 (form
  만 paradigm 분기).
- **AC-28-10** Collection create form — Standard / Capped / Time-series
  radio 3 type 모두 생성 가능. Drop / Rename 동작.
- **AC-28-11** DB create wrapper (이름 + 첫 collection) + DB drop
  confirmation (이름 재타이핑).
- **AC-28-12** RDB 모든 회귀 green — paradigm 통합 (B, C, G, K) 가 RDB
  영역 깨지 않음.

## TDD 정책

- Slice A 의 Rust/WASM parser routing — Rust 단위 테스트 + React parser
  wrapper 테스트.
  파서가 11 method × 표준 인자 형태를 빠짐없이 추출.
- 각 slice 표준 RED → GREEN. UI 변경은 RTL 단위 테스트.
- Mongo backend → 기존 `MongoAdapter` 단위 + integration (testcontainers)
  코어 method 모두 커버.

## E2E 시나리오 (안)

| ID | 시나리오 |
|----|---------|
| E28-01 | mongosh editor 에 `db.users.find({age:{$gt:30}}).limit(10)` → 결과 grid |
| E28-02 | DataGrid Filter Bar 의 `$regex` 입력 → server-side filter |
| E28-03 | Sort 두 컬럼 (이름 ASC + age DESC) → header context menu |
| E28-04 | `address.city` 컬럼을 ⋯ 클릭으로 promote → city 컬럼 정렬 → cell edit → Commit → `$set: {"address.city": ...}` 검증 |
| E28-05 | ObjectId 컬럼 — "Generate" 버튼 → 새 doc insert |
| E28-06 | Field projection 에서 `password` 제외 → `password` 컬럼 안 보임 + 네트워크 페이로드에서 제외 |
| E28-07 | DataGrid 3 row 동시 변경 → Commit (transaction toggle ON) → 한 doc fail 시 전체 rollback |
| E28-08 | Indexes 탭에서 Ops = 0 인 index drop |
| E28-09 | View create — pipeline 입력 → 사이드바에 view 노출 → 클릭 시 결과 grid |
| E28-10 | Capped collection 만들기 (Type=Capped, size=100MB) → 사이드바 노출 |
| E28-11 | DB drop confirmation — 잘못 입력 → block, 정확히 입력 → drop |
| E28-12 | PG 와 Mongo 두 connection 동시 열기 → tab 의 paradigm 분리, 한 쪽 결정이 다른 쪽 영향 없음 |

## 위험 / 미정

- **R28.1** parser/completion SOT 는 Rust/WASM 으로 이미 정리됐지만 Query
  Editor dispatch path 는 아직 legacy toggle / TS wrapper 의존이 남아 있을 수
  있음 — Slice A1 에서 boundary audit.
- **R28.2** ISODate picker 의 RDB TIMESTAMP 컴포넌트 공유 — 현재 RDB 의
  TIMESTAMP cell editor 가 별도 컴포넌트로 분리되어 있는지 확인. 아니면
  분리 작업 선행.
- **R28.3** `+ Insert ▾` dropdown 의 4 section 이 toolbar 폭 압박 가능 —
  collapsed 라벨 디자인 필요.
- **R28.4** transaction 미지원 환경 (standalone Mongo) 에서 toggle ON 시
  실패 메시지 친화도.

## Phase Exit Gate

- Skip-zero, AC-28-01..12 잠금.
- RDB paradigm 통합 (B, C, G, K) 의 RDB 회귀 0.
- E28 suite green.
- 보안 영역 (Q30, Q31) 의 별도 threat-model 핸드오프 일정 확정 — 본 phase
  종료 시점에 Phase 29 (보안) 와 Unified Followups phase 진입 순서 결정.

## Demo / 산출물

본 phase 의 grill 진행 중 사용된 HTML mock 시리즈는 결정 lock 후 폐기.
재현이 필요하면 `feedback_demo_html_for_grill.md` 패턴을 따라 새로
작성한다.
