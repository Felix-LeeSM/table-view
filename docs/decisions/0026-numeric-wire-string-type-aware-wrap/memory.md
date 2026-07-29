---
id: 0026
title: 수치 wire-format — string token + frontend type-aware wrap (BigInt / Decimal / Number)
status: Accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

**결정**: PostgreSQL / MongoDB adapter 가 정밀도 손실 위험이 있는 numeric 컬럼 값 (PG `bigint`/`int8`/`bigserial`, PG `numeric`/`decimal`, Mongo `Int64`, Mongo `Decimal128`) 을 IPC wire 위에서 **JSON string token** 으로 직렬화한다. Frontend 의 `src/lib/tauri.ts` 에 명령별 wrapper 함수가 native `JSON.parse` 통과 후 응답을 받아, `column.data_type` 기반의 **type-aware post-processing** 으로 셀 값을 `BigInt(...)` / `new Decimal(...)` / 그대로 유지 중 하나로 변환한다. JSON.parse hook / `json-bigint` 등 parser 교체 없이, 별도 `invoke` wrapper 없이, 기존 Tauri IPC 흐름 그대로 사용.

**이유**:

(1) **JavaScript Number 의 정밀도 한계**: IEEE 754 double 로 안전하게 표현 가능한 정수 범위는 ±(2^53-1). PG `bigint` (i64) / Mongo `Int64` (i64) 가 이를 초과할 수 있다. PG `numeric` / Mongo `Decimal128` 은 base-10 임의 정밀도라 IEEE 754 binary float 으로 표현 불가. → 이 4 종은 wire 위에서 raw JSON number 로 보내면 native `JSON.parse` 가 f64 변환하며 손실.

(2) **JSON.parse 의 String 토큰은 byte-preserving**: `JSON.parse('"9223372036854775807"')` → JS string `"9223372036854775807"` (digits 모두 보존). `JSON.parse('9223372036854775807')` → JS number `9223372036854776000` (손실). String 토큰만 wire 에 올리면 native parser 가 손실 0 으로 보존.

(3) **Tauri IPC 의 deserialize hook 불가**: `window.__TAURI_INTERNALS__.invoke` 가 native bridge 내부에서 JSON.parse 를 호출. global JSON.parse override 는 너무 침투적이고 (React 라이브러리 영향), monkey-patch 는 fragile. → wire 자체를 string 으로 보내 native JSON.parse 한계를 우회.

(4) **column metadata 기반 type-aware wrap 의 일관성**: BigInt / Decimal 사용 결정을 wire 값 크기 (json-bigint 의 디지트 자동 감지) 가 아니라 **컬럼 타입** 으로 함. 같은 컬럼은 row 마다 같은 JS 타입 → 사용자가 `typeof` 분기를 row 단위로 할 일이 없음. json-bigint 의 value-based 자동 감지는 같은 컬럼 안에서 row 별로 `Number` 와 `BigInt` 가 섞여 혼란.

(5) **Float (IEEE 754) 은 Decimal 로 wrap 안 함**: PG `real`/`double precision`, Mongo `Double` 는 본질적으로 부정확한 base-2 근사값. JS `Number` 와 동일한 IEEE 754 64-bit 표현이므로 무손실 round-trip. Decimal 로 wrap 하면 "정확한 값" 인 척하게 됨 → 의미 왜곡.

**트레이드오프**:

**장점**:
- 정밀도 0 손실. wire = string → JS = BigInt/Decimal.
- 외부 parser 라이브러리 (`json-bigint`) 불필요. 기존 Tauri `invoke` 흐름 그대로.
- 같은 컬럼 = 같은 JS 타입. 사용자가 type 분기를 row 단위로 안 해도 됨.
- column metadata 가 BigInt/Decimal 결정의 single source of truth — 휴리스틱 없음.
- Float 은 그대로 Number 유지 → 의미 왜곡 없음.

**단점**:
- BigInt / Decimal 친화 boilerplate: `JSON.stringify` 가 BigInt 에 대해 TypeError 던지므로 `safeStringifyCell` / queryHistory serialization / Export CSV/JSON 등에 BigInt-safe replacer (`replacer(_, v) => typeof v === "bigint" ? v.toString() : v instanceof Decimal ? v.toString() : v`) 통일 필요. ~6–10 곳.
- `decimal.js` 의존성 추가 (~30KB). 자체 구현 vs lib 채택 비교 — lib 채택이 단순.
- Cell renderer (`DataRow.tsx`, `DocumentDataGrid.tsx`, `QueryResultGrid.tsx`, `EditableQueryResultGrid.tsx`) 가 `typeof === "bigint"` / `instanceof Decimal` 분기 추가. 최소 변경 (display 는 `.toString()` 또는 `String(cell)` 으로 동일).
- jsonb 내부 nested 큰 정수의 정밀도 보존은 **scope 밖**. column metadata 가 jsonb 안쪽에는 안 들어감. 별도 backlog.
- Tauri invoke 가 응답을 `Result<QueryResult, _>` 로 typed deserialize 하지만, 내부 cells 가 `serde_json::Value::String("9223...")` 으로 들어가므로 JS 도착 시 `unknown[][]` 안에 string 토큰이 섞임 — 기존 `unknown` 타입과 호환되어 TypeScript 변경 없음.

**구현 위치**:

1. **Rust backend** (`src-tauri/src/db/postgres/queries.rs`, `mongodb/queries.rs`):
   - PG: `row_to_json(q)::text` 파싱 직후, `column.data_type` 기반으로 bigint/numeric 컬럼의 `Value::Number` → `Value::String(n.to_string())` 변환.
   - Mongo: `flatten_cell` 의 `Bson::Int64(n)` → `Value::String(n.to_string())`, `Bson::Decimal128(d)` → `Value::String(d.to_string())`. 다른 BSON 타입은 `into_canonical_extjson()` 유지.

2. **Frontend wrapper** (`src/lib/tauri.ts`):
   - `wrapNumericCells(result)` 헬퍼: result.columns 의 data_type 보고 row 별 cell 을 `BigInt(...)` / `new Decimal(...)` 로 변환.
   - executeQuery / queryTableData / findDocuments / executeQueryBatch 등 numeric-heavy wrapper 함수마다 post-call 호출.

3. **Frontend boilerplate**:
   - `src/lib/jsonCell.ts` `safeStringifyCell` — BigInt/Decimal replacer 적용.
   - queryHistoryStore, ExportButton CSV/JSON, QuickLook tree viewer 의 JSON.stringify 호출처에 동일 replacer 적용.
   - 4 grid cell renderer: cell display 가 `typeof === "bigint"` / `instanceof Decimal` 시 `.toString()` 사용.
   - Editor (`useDataGridEdit.ts`): pending edit string 초기화 시 `.toString()`.

**관련**:

- Sprint 261 spec — AC-261-01..05 구현.
- Sprint 260 ADR 0025 (DataGrid 자체 관리) — 이번 결정이 cell 타입 다양화를 도입하지만 grid 가 자체 관리 정책이므로 lib 종속 안 됨.
- Sprint 238 `safeStringifyCell` — replacer 보강 site.
- Mongo `flatten_cell` 의 `into_canonical_extjson()` — Int64/Decimal128 케이스 분기 우선 적용, ObjectId/Date/Binary 는 유지.

**관련 코드**:

- `src-tauri/src/db/postgres/queries.rs` (row_to_json 사이트 3 곳: 약 L227, L689, L773)
- `src-tauri/src/db/mongodb/queries.rs` `flatten_cell` (L231-237)
- `src/lib/tauri.ts` (명령 wrapper 함수들)
- `src/lib/jsonCell.ts` `safeStringifyCell` (L3)
- `src/components/datagrid/useDataGridEdit.ts` `getInputTypeForColumn` / `classifyDataType` (L32, L63)
- 4 grid cell renderer: `DataGridTable/DataRow.tsx`, `DocumentDataGrid.tsx`, `QueryResultGrid.tsx`, `EditableQueryResultGrid.tsx`
