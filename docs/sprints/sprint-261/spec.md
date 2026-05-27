# Sprint 261 Spec — 수치 wire-format 정밀도 보존 (ADR 0026 구현)

## Feature Description

ADR 0026 에서 lock 된 결정에 따라 PG / Mongo adapter 가 정밀도 위험 numeric 컬럼 (PG `bigint`/`numeric`, Mongo `Int64`/`Decimal128`) 을 **JSON string token** 으로 wire 에 직렬화하고, Frontend wrapper 가 column metadata 기반 type-aware post-processing 으로 `BigInt` / `Decimal` / `Number` 로 변환한다. `json-bigint` / `JSON.parse` override 등 parser 교체 없이 native Tauri IPC 흐름 그대로 사용.

## Sprint Breakdown

단일 sprint (Sprint 261). 슬라이스 4 개:
1. **Slice A**: Rust backend stringify (PG queries.rs 3 site + Mongo flatten_cell). 단위 + 통합 테스트.
2. **Slice B**: Frontend wrapper helper (`src/lib/tauri.ts` `wrapNumericCells`) + decimal.js 의존성 + boilerplate replacer.
3. **Slice C**: 4 grid cell renderer + editor 의 BigInt/Decimal 친화 처리.
4. **Slice D**: 회귀 가드 (전체 frontend tests + cargo clippy + tsc + lint).

## Acceptance Criteria

### AC-261-01 — ADR 0026 lock

- `docs/archives/decisions/0026-numeric-wire-string-type-aware-wrap/memory.md` 작성.
- `docs/archives/decisions/memory.md` 인덱스 entry 추가.
- **상태**: 완료 (이번 sprint 첫 작업).

### AC-261-02 — Rust backend numeric stringify

#### PostgreSQL adapter (`src-tauri/src/db/postgres/queries.rs`)

- `row_to_json(q)::text` 파싱 후, 행 구성 단계에서 `column.data_type` 검사:
  - `data_type` 이 `bigint`, `int8`, `bigserial` 중 하나 → 해당 cell 의 `Value::Number(n)` 를 `Value::String(n.to_string())` 으로 변환.
  - `data_type` 이 `numeric`, `decimal` substring 포함 → 동일 변환.
- 적용 site: `execute_query` (L201-243), `query_table_data` (L619-714), `stream_table_rows` (L729-810).
- `int2`/`int4`/`real`/`double precision`/`float4`/`float8` 컬럼은 변환 **안 함** (Value::Number 그대로) — JS Number 와 동일 표현 → 무손실.
- 단위 test:
  - `test_query_table_data_bigint_value_is_string_wire` — 9223372036854775807 값이 응답에서 `Value::String("9223372036854775807")`.
  - `test_query_table_data_numeric_value_is_string_wire` — `numeric(20,18)` 의 큰 십진수.
  - `test_query_table_data_int4_value_remains_number_wire` — `integer` 컬럼은 number 그대로.

#### MongoDB adapter (`src-tauri/src/db/mongodb/queries.rs`)

- `flatten_cell` (L231-237) 의 `match b` 에 분기 추가:
  - `Bson::Int64(n)` → `Value::String(n.to_string())` (canonical extjson `{$numberLong: "..."}` wrapper 우회).
  - `Bson::Decimal128(d)` → `Value::String(d.to_string())` (canonical extjson `{$numberDecimal: "..."}` wrapper 우회).
  - 다른 BSON 타입 (`Bson::ObjectId`, `Bson::DateTime`, `Bson::Binary`, ...) → 기존 `into_canonical_extjson()` 유지 (정밀도 무관, 타입 discriminator).
  - `Bson::Int32` / `Bson::Double` → 기존 `into_canonical_extjson()` 유지 (Number 안전 범위).
- 단위 test:
  - `test_flatten_cell_int64_emits_plain_string` — `Bson::Int64(9223372036854775807)` → `Value::String("9223372036854775807")`.
  - `test_flatten_cell_decimal128_emits_plain_string` — `Bson::Decimal128(...)` → `Value::String(...)`.
  - `test_flatten_cell_objectid_remains_extjson_wrapper` — ObjectId 는 `{$oid: "..."}` 유지.
  - `test_flatten_cell_int32_remains_number` — Int32 는 raw number 유지.

### AC-261-03 — Frontend wrapper helper + decimal.js 도입

#### 라이브러리 추가
- `pnpm add decimal.js` (frontend).

#### `src/lib/tauri.ts` 헬퍼
- `wrapNumericCells<T extends { columns: ...; rows: unknown[][] }>(result: T): T`:
  - `result.columns[i].data_type` 보고 wrapper 결정 (bigint family → `BigInt`, numeric/decimal family → `Decimal`, 그 외 → noop).
  - row 별 cell 순회, `typeof cell === "string"` 일 때만 wrap (이미 BigInt/Decimal 인 경우 무변환).
- numeric-heavy wrapper 함수에 호출 추가:
  - `executeQuery`, `executeQueryBatch`, `queryTableData`, `findDocuments`, `aggregateDocuments`, `streamTableData` (if any).
- 단위 test (`src/lib/tauri.test.ts` 신규):
  - `test_wrapNumericCells_bigint_column_string_to_bigint` — bigint 컬럼 string → BigInt.
  - `test_wrapNumericCells_decimal_column_string_to_decimal` — numeric/decimal 컬럼 string → Decimal.
  - `test_wrapNumericCells_int4_column_number_passthrough` — integer 컬럼 number 그대로.
  - `test_wrapNumericCells_text_column_string_passthrough` — text 컬럼 string 그대로.
  - `test_wrapNumericCells_idempotent` — 이미 BigInt/Decimal 인 cell 은 무변환.

### AC-261-04 — `safeStringifyCell` 및 boilerplate BigInt/Decimal replacer

#### `src/lib/jsonCell.ts`
- `safeStringifyCell(value)` 가 BigInt/Decimal 친화:
  - replacer: `typeof v === "bigint" ? v.toString() : v instanceof Decimal ? v.toString() : v`.
- 단위 test:
  - `test_safeStringifyCell_bigint` — BigInt 셀이 digit string 으로 직렬화.
  - `test_safeStringifyCell_decimal` — Decimal 셀이 string 으로 직렬화.
  - 기존 케이스 (object/null/text) 유지.

#### 다른 JSON.stringify 사이트
- `queryHistoryStore` serialization — entry 의 cell 데이터를 history 에 저장 시 동일 replacer 적용 (있다면).
- `ExportButton` CSV/JSON — cell 값 출력 시 `String(cell)` 또는 replacer 적용.
- 회귀 단위 test 는 wrapper 함수 단에서 검증 (cell rendering 단계까지 손실 없으면 OK).

### AC-261-05 — 4 grid cell renderer + editor 의 BigInt/Decimal 분기

#### Renderer (4 grid)
- `DataGridTable/DataRow.tsx`, `DocumentDataGrid.tsx`, `QueryResultGrid.tsx`, `EditableQueryResultGrid.tsx`:
  - cell display 분기 추가:
    - `typeof cell === "bigint"` → `cell.toString()`
    - `cell instanceof Decimal` → `cell.toString()`
    - 기존 number / string / object 분기 유지.
  - `title` (tooltip) 도 동일.
  - 단위 test (각 grid 의 component test 에 케이스 추가):
    - `renders_bigint_cell_as_digits_text` — BigInt 셀 화면에 digits 표시.
    - `renders_decimal_cell_as_digits_text` — Decimal 셀 화면에 digits 표시.

#### Editor (`useDataGridEdit.ts`)
- `cellToEditValue(cell)` 가 BigInt/Decimal 친화:
  - `typeof === "bigint"` 또는 `instanceof Decimal` 이면 `cell.toString()` 반환.
- pending edit 직렬화 (이미 string Map) 그대로 사용 — backend 로 보낼 때 SQL 안의 numeric literal 자리에 `.toString()` 결과 string 그대로 입력.
- 단위 test:
  - `test_cellToEditValue_bigint_returns_decimal_string` — BigInt → "9223372036854775807".
  - `test_cellToEditValue_decimal_returns_decimal_string` — Decimal → "123.45".

### AC-261-06 — 회귀 가드 (no test 누락)

- frontend tests baseline 3215 (sprint-260 + row-overflow 후) 유지 또는 증가.
- Rust tests baseline 656 (직전 commit 기준) 유지 또는 증가.
- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` exit 0.

## Out of Scope (Sprint 262+ 또는 별도 backlog)

- **jsonb 내부 nested 큰 정수의 정밀도 보존** — column metadata 가 nested 안쪽엔 안 들어감. 별도 sprint (recursive walk 또는 jsonb 셀 자체 stringify).
- **BigInt / Decimal 값 입력 시 backend writeback 검증** — 본 sprint 는 read-path + display 위주. write-back 의 SQL literal escaping, Mongo BSON 변환은 별도 sprint.
- **PG `money` 타입** — `numeric` 으로 매핑된 상태. 별도 처리 필요 시 follow-up.
- **MongoDB raw_documents (Quick Look)** — extjson canonical 유지. 트리 뷰어가 wrapper 객체 그대로 표시. 별도 sprint.
- **Export CSV / JSON 의 BigInt/Decimal 형식 협의** — replacer 로 string 직렬화는 보장하지만 사용자가 원하는 export 형식 (quoted vs unquoted) 은 별도 결정.

## Sprint Schedule / Slicing

1. **Slice A** (Rust backend): PG stringify 3 site + Mongo flatten_cell. Rust 단위 test + 통합 test 보강. (1-2 일)
2. **Slice B** (Frontend wrapper): decimal.js 추가, `wrapNumericCells` 헬퍼 + tauri.ts wrapper 함수 적용 + 단위 test. (1-2 일)
3. **Slice C** (Cell renderer + editor): 4 grid renderer 분기 + `useDataGridEdit` editor + boilerplate replacer. component tests. (1-2 일)
4. **Slice D** (회귀): 전체 frontend test suite + Rust clippy + tsc + lint. (반 일)

총 약 4-6 일.
