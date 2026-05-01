# Sprint Contract: sprint-181

## Summary

- **Goal**: TablePlus 패리티의 1순위 갭이었던 **결과 그리드 → 파일 export**
  를 닫는다. 세 surface(`src/components/rdb/DataGrid.tsx` 테이블 데이터 뷰,
  `src/components/document/DocumentDataGrid.tsx` Mongo 컬렉션 뷰,
  `src/components/query/QueryResultGrid.tsx` 쿼리 결과)에 동일한
  `<ExportButton>` 컴포넌트를 마운트하고, 백엔드의 새 Tauri command
  `export_grid_rows` 가 `tauri-plugin-dialog`의 `save` API로 받은 경로에
  CSV / TSV / SQL `INSERT` / JSON 네 포맷을 스트리밍 write 한다. 변환은
  **Rust 측에서만** 수행 — 프론트엔드는 row 배열을 IPC payload로 보내고
  포맷·escape·NULL 직렬화 결정에는 관여하지 않는다 (TablePlus 와 동등한
  결정론적 출력 보장).
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (browser + command + api).

## In Scope

- `AC-181-01`: 세 surface(`DataGrid`, `DocumentDataGrid`, `QueryResultGrid`) 우상단
  결과 영역에 `<ExportButton>` 이 마운트된다. 클릭 시 포맷 선택 드롭다운이
  열리며 항목은 RDB 두 surface 에서 `["CSV", "TSV", "SQL INSERT"]`,
  Mongo surface 에서 `["JSON", "CSV", "TSV"]`. **JSON은 Mongo 한정**(BSON
  표현이 의미 있는 곳), **SQL INSERT는 RDB 한정**(스키마/테이블 컨텍스트가
  있어야 INSERT 문을 만들 수 있음). Vitest 로 세 surface 각각에 대해
  버튼 존재 + 메뉴 항목 집합을 단언.

- `AC-181-02`: 포맷 선택 후 `tauri-plugin-dialog` 의 `save` API 가 호출되어
  파일 경로를 받는다. 기본 파일명은 `<context>_<YYYYMMDD-HHMMSS>.<ext>`
  형식 (예: `users_20260501-143012.csv`, `query_20260501-143012.sql`).
  context는 RDB 테이블 surface = `<schema>.<table>`, Mongo = `<collection>`,
  쿼리 결과 = `query`. 사용자가 dialog 를 취소하면 export 도 취소되며 UI 에
  실패 toast 가 뜨지 않는다 (silent cancel — 사용자 의도). 파일 경로
  결정 로직은 `src/lib/export/filename.ts` 한 곳에 단위 테스트와 함께
  격리된다.

- `AC-181-03`: **CSV 출력 RFC 4180 준수.** 첫 줄은 컬럼명 헤더, 그 뒤
  row 들. 셀 값에 `,` 또는 `"` 또는 `\n` 또는 `\r` 이 포함되면 `"` 로 감싸고
  내부 `"` 는 `""` 로 escape. 줄 종결자는 `\r\n` (RFC 4180). 인코딩 UTF-8
  with BOM (`\u{FEFF}` prefix) — Excel 호환성. NULL → 빈 문자열. boolean →
  `true` / `false`. 숫자/날짜 → 원본 문자열. 바이너리(blob) → base64 prefix
  `\\x` (PG 관습 그대로). Rust 단위 테스트가 모든 escape 케이스를 cover.

- `AC-181-04`: **TSV 출력** — 셀 구분자 `\t`, 줄 종결자 `\n`. TSV는 escape
  규칙이 없는 게 관례 (탭/줄바꿈 포함 셀은 호환성을 위해 공백으로 치환).
  헤더 1줄 + row N줄. UTF-8 (BOM 없음). NULL → 빈 문자열.

- `AC-181-05`: **SQL `INSERT` 출력 (RDB 전용)** — 한 row 당 한 statement
  형식 `INSERT INTO "<schema>"."<table>" ("col1", "col2", …) VALUES (…);`.
  컬럼·테이블 식별자는 큰따옴표 ANSI 식별자 quoting. 값 직렬화: 문자열 →
  작은따옴표 quoting + 내부 `'` 는 `''` escape; NULL → `NULL` literal;
  숫자 → 원본 그대로; boolean → `TRUE` / `FALSE`; 날짜/타임스탬프 →
  `'<ISO 8601>'::timestamptz`; JSON/JSONB → `'<json>'::jsonb`; bytea →
  `'\x<hex>'::bytea`. **쿼리 결과 surface(`QueryResultGrid`) 에서 SQL
  format 을 고를 때**, 결과셋이 단일 테이블 SELECT 가 아니면 (JOIN /
  GROUP BY / 집계 등) 식별자 컨텍스트를 추론할 수 없으므로 메뉴 항목이
  비활성화되고 tooltip `"Single-table SELECT only"` 가 노출된다. 추론
  규칙: SELECT 결과 metadata 의 `source_table` 이 모든 컬럼에서 동일한
  단일 값일 때만 활성화 (`src-tauri/src/db/postgres.rs` 의 row metadata
  를 활용).

- `AC-181-06`: **JSON 출력 (Mongo 전용)** — `JSON Array` 형태, 각 element 는
  Extended JSON v2 Relaxed 모드. `ObjectId` → `{"$oid": "..."}`, `Date` →
  `{"$date": "<ISO>"}`, `BinData` → `{"$binary": {"base64": "...",
  "subType": "..."}}`, `Decimal128` → `{"$numberDecimal": "..."}`,
  나머지는 표준 JSON. 개행 `\n` 으로 prettify (indent 2 spaces).

- `AC-181-07`: **스트리밍 write.** `export_grid_rows` 는 row 배열 전체를
  메모리에 적재하지 않고, payload 의 row iterator 를 `BufWriter<File>` 로
  순차 write 한다. 100,000 row 시뮬레이션 (Rust 단위 테스트 + 임시 파일)
  에서 최대 RSS 증가가 row 데이터 자체 크기의 2배를 넘지 않음을 확인 —
  `tempfile` crate 로 임시 파일 생성, 100k 가짜 row 를 write, 파일 라인
  수를 검증. **취소 토큰 통합**: Sprint 180 의 `query_tokens` 레지스트리
  를 그대로 재사용해 `export_id: Option<String>` 파라미터로 등록·해제.
  사용자가 export 진행 중 취소 시 `tokio::select!` 로 write loop 가 즉시
  종료되고 부분 파일이 남으면 자동 삭제 (`std::fs::remove_file`).

- `AC-181-08`: **NULL / 특수값 직렬화 일관성.** 위 AC-181-03..06 의 NULL
  규칙이 아무 surface 에서나 동일하게 적용됨을 단위 테스트로 고정.
  포맷별 fixture: `[ "alice", null, 42, true, "2026-05-01T00:00:00Z", { "k": "v" } ]`.

- `AC-181-09`: **에러 surface.** 디스크 full / 권한 거부 / 경로 부재 등은
  `AppError::Io(String)` 로 propagate, 프론트엔드는 `useToast` 의
  destructive 변형으로 노출 (`Export failed: <reason>`). dialog 취소는
  에러가 아니므로 toast 없음 (AC-181-02). Vitest 가 `invoke` 를 reject
  시키고 destructive toast 출현을 단언.

- `AC-181-10`: **회귀 가드.** 세 surface 의 기존 동작(정렬/필터/페이지네
  이션/인라인 편집/Sprint 180 cancel 오버레이/Sprint 176 pointer-event
  하드닝) 이 ExportButton 마운트로 인해 깨지지 않음을 기존 surface 테스트가
  text-string 수정 없이 통과.

### Files allowed to modify

- `src-tauri/Cargo.toml` — `csv = "1"` 의존성 추가 (RFC 4180 준수 escape
  를 손으로 다시 짜는 것보다 검증된 crate 가 안전). 다른 crate 추가는 금지.
- `src-tauri/src/commands/export.rs` (new) — `export_grid_rows` Tauri command.
  파라미터: `format: ExportFormat (Csv|Tsv|SqlInsert|JsonArray)`,
  `target_path: PathBuf`, `headers: Vec<String>`, `rows: Vec<Vec<JsonValue>>`,
  `context: ExportContext (TableData{schema,table} | QueryResult{source_table:Option<...>} | Collection{name})`,
  `export_id: Option<String>`. 반환: `Result<ExportSummary, AppError>`
  (`ExportSummary { rows_written: u64, bytes_written: u64 }`).
- `src-tauri/src/commands/mod.rs` — `pub mod export;` 추가 + handler
  registration in `src-tauri/src/lib.rs`.
- `src-tauri/src/lib.rs` — `tauri::generate_handler![…, commands::export::export_grid_rows]`
  에만 추가; setup / menu / RunEvent 분기 무관.
- `src-tauri/src/error.rs` — `AppError::Io(String)` variant 가 이미 있는지
  확인하고, 없으면 추가. 기존 variant 재명명·삭제 금지.
- `src/lib/export/` (new directory):
  - `src/lib/export/filename.ts` (new) — `buildExportFilename(context, format, now)` 순수 함수.
  - `src/lib/export/filename.test.ts` (new).
  - `src/lib/export/index.ts` (new) — `ExportFormat`, `ExportContext` TS types + `runExport(...)` (포맷 선택 → save dialog → invoke → toast).
- `src/lib/tauri.ts` — `exportGridRows(...)` wrapper 추가 (다른 wrapper 와 동일 패턴).
- `src/components/shared/ExportButton.tsx` (new) — 버튼 + 드롭다운 메뉴.
  Props: `context: ExportContext`, `headers: string[]`, `getRows: () => Promise<unknown[][]>` (lazy — 페이지네이션 surface 가 export 시점에 전체 row 를 fetch 할 수 있도록), `disabledFormats?: ExportFormat[]`.
- `src/components/shared/ExportButton.test.tsx` (new) — AC-181-01, 02, 09.
- `src/components/rdb/DataGrid.tsx` — 우상단 영역에 `<ExportButton>` 마운트.
  `getRows` 는 현재 페이지 + (사용자 선택 시) 전체 fetch — Phase 1 은
  **현재 페이지 row 만** 우선 (전체 fetch 는 별도 sprint, AC 외).
- `src/components/document/DocumentDataGrid.tsx` — 동일.
- `src/components/query/QueryResultGrid.tsx` — 동일. `disabledFormats` 는
  `source_table` 추론 결과에 따라 `["sql"]` 가 들어갈 수 있음.
- 위 세 surface 의 기존 `*.test.tsx` — 마운트 회귀 가드만 (1줄 추가).
  기존 assertion 수정 금지.
- `docs/sprints/sprint-181/findings.md` (new).
- `docs/sprints/sprint-181/handoff.md` (sprint deliverable).

## Out of Scope

- **Data import (CSV → 테이블)** — 별도 sprint. 본 sprint 는 export 만.
- **전체 테이블 export (페이지를 가로지르는 fetch-all + stream)** — Phase 2.
  본 sprint 는 "현재 화면에 보이는 row" 만 대상. UI 에 "Export all rows"
  옵션은 노출하지 않는다 (오해 방지).
- **Excel (`.xlsx`) / Parquet / XML** — 추가 포맷은 Phase 2.
- **Compression (`.gz`)** — out.
- **Schema export (DDL `pg_dump` 통합)** — Sprint #6 이후 별도.
- **export 진행률 UI** — 큰 데이터셋에서도 본 sprint 의 row 수는 페이지
  단위 (수천 행)이므로 progress bar 불필요. Sprint 180 cancel overlay 는
  공유하지 않는다 (export 는 사용자가 명시 시작한 일시 작업).
- **MongoDB Extended JSON Canonical mode** — Relaxed mode 만 지원.
- **Sprint 180 의 cancel-token 레지스트리 코어 변경** — 재사용만, 시그니
  처/내부 로직 수정 금지.
- **`Paradigm` 타입 (`src/types/connection.ts:15`) 수정** — 읽기만.
- **e2e 테스트** — Vitest + cargo test + 수동 smoke 충분.
- **Sprint 175~180 의 contract / spec / handoff** — touched 0.

## Invariants

- **ADR-0005**: plaintext password 백엔드 전용. export payload 는 row
  데이터만 — 절대 connection 정보 / password 를 포함하지 않는다. 단위
  테스트가 ExportButton 의 IPC payload 에 password 가 부재함을 grep 로 단언.
- **Sprint 180 cancel-token 레지스트리 시그니처 불변**: `state.query_tokens`
  의 타입 (`Mutex<HashMap<String, CancellationToken>>`) 그대로 재사용.
  `cancel_query` command wire 시그니처도 변경 금지.
- **Sprint 176 pointer-event hardening**: 세 surface 의 기존 overlay
  pointer 가드는 그대로. ExportButton 은 overlay 외부에 배치되므로 무관.
- **strict TS / Rust**: `any` 금지, `unwrap()` 테스트 외 금지,
  `cargo clippy --all-targets --all-features -- -D warnings` zero,
  `pnpm tsc --noEmit` zero, `pnpm lint` zero.
- **`Paradigm` 타입 (`src/types/connection.ts:15`) 불변**.
- **신규 런타임 의존성 0** (frontend) — `package.json` 미변경.
  Rust 는 `csv` crate 한 개만 추가 (검증된 표준 crate).
- **`it.skip` / `it.todo` / `xit` skip-zero gate** (AC-GLOBAL-05) 유지.
- **기존 surface 테스트의 텍스트 어서션 미수정** — ExportButton 마운트
  추가만 허용.

## Acceptance Criteria

- `AC-181-01` — 세 surface 의 결과 영역 우상단에 ExportButton 이 있고,
  포맷 선택 메뉴가 surface 별 사양대로 노출된다. Vitest 가 surface 별로
  `getByRole("button", { name: /export/i })` + 메뉴 열기 + 항목 단언.
- `AC-181-02` — `tauri-plugin-dialog` 의 `save` 가 호출되며 기본 파일명이
  사양대로 생성된다. `buildExportFilename` 단위 테스트 + ExportButton
  통합 테스트가 cover. 사용자 취소 (save 가 `null` 반환) 시 toast 없음.
- `AC-181-03` — CSV 출력이 RFC 4180 준수. Rust 단위 테스트가 escape
  케이스 (`,` `"` `\n` `\r` 포함) 와 BOM 첫 3바이트 (`EF BB BF`) 를 단언.
- `AC-181-04` — TSV 출력이 사양대로. 단위 테스트가 헤더 + row + 탭/줄바꿈
  치환을 단언.
- `AC-181-05` — SQL INSERT 출력이 사양대로. RDB 단일-테이블 SELECT 추론
  로직이 정상 동작 — 단일 source 가 아니면 메뉴 비활성화. 단위 테스트가
  `source_table` 단일/다중 케이스 두 분기를 cover.
- `AC-181-06` — Mongo JSON 출력이 Extended JSON v2 Relaxed. ObjectId /
  Date / BinData 직렬화 단언.
- `AC-181-07` — 100k row 스트리밍 단위 테스트가 file 라인 수 + 메모리
  growth 가드를 통과. 취소 토큰 cancel → write loop 종료 + 부분 파일 삭제
  단언.
- `AC-181-08` — NULL / boolean / 숫자 / 날짜 / JSON / bytea 직렬화가
  포맷 4종에서 일관. 단일 fixture 로 4 포맷 출력 골든 스냅샷.
- `AC-181-09` — Io 에러 → destructive toast. dialog 취소 → toast 없음.
- `AC-181-10` — 세 surface 의 기존 테스트가 text-string 수정 없이 통과.

## Design Bar / Quality Bar

- **변환은 Rust** — frontend 는 row 를 JSON serializable 한 형태로 보내고
  포맷·escape 결정 일체에 관여하지 않는다. 결정론적 출력의 단일 진실원이
  Rust 측 `commands/export.rs`.
- **포맷 enum**: `ExportFormat` 은 Rust `#[derive(Serialize, Deserialize)]`
  enum + TS `type ExportFormat = "csv" | "tsv" | "sql" | "json"` 두 곳에
  존재. 두 표현이 동일한 wire string ("csv" 등) 을 쓰도록 `serde(rename_all = "lowercase")` 명시.
- **파일명 생성**: `buildExportFilename(context, format, now: Date)` 순수
  함수. context 는 discriminated union — RDB table = `{kind:"table", schema, name}`,
  Mongo = `{kind:"collection", name}`, query = `{kind:"query"}`. now 는
  주입 가능 (테스트 결정성).
- **CSV crate 사용**: `csv = "1"` (Burntsushi). RFC 4180 준수 + UTF-8
  검증을 자체 구현하지 않는다. BOM 은 writer 외부에서 prefix 로 직접 write
  (crate 가 BOM 을 옵션으로 다루지 않음).
- **SQL identifier quoting**: `"` 둘러싸고 내부 `"` 는 `""` escape
  (ANSI SQL). 모든 PG `quote_ident` 동작 mirror.
- **취소 토큰 패턴**: Sprint 180 의 `tokio::select!` 패턴 그대로 차용.
  레지스트리 cleanup 은 cancel 호출 전에 (Sprint 180 invariant 와 동일).
- **에러 분류**: dialog 사용자 취소는 에러가 아니다 — `Result<Option<...>>`
  로 path 가 None 이면 "취소된 것" 으로 분기. Rust 의 io 에러는
  `AppError::Io` 로 wrap.
- **세 surface 통합 위치**: 결과 영역의 toolbar 우상단. Sprint 180 cancel
  overlay 는 결과 영역 위에 absolute, ExportButton 은 toolbar 안 — 두
  surface 가 충돌하지 않게 layout 검증 (Vitest snapshot 또는 수동 smoke).
- **단위 테스트 명명**: `[AC-181-0X] …` prefix 로 AC 와 매핑. 각 신규
  테스트에 `// AC-181-0X — <reason>; date 2026-05-01.` 코멘트 (auto-memory
  `feedback_test_documentation.md`, 2026-04-28).
- **커버리지**: 신규/수정 라인 70% 이상. CSV escape / SQL identifier
  quoting / Extended JSON 직렬화 90% 이상.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/export src/components/shared/ExportButton.test.tsx
   src/components/rdb/DataGrid.test.tsx src/components/document/DocumentDataGrid.test.tsx
   src/components/query/QueryResultGrid.test.tsx` — 신규 + 통합 회귀, 모두 green,
   `[AC-181-0X]` prefix 로 매핑 가시.
2. `pnpm vitest run` — 전체 suite green (회귀 0).
3. `pnpm tsc --noEmit` — zero errors.
4. `pnpm lint` — zero errors.
5. `cargo build --manifest-path src-tauri/Cargo.toml` — clean build.
6. `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings` — zero.
7. `cargo test --manifest-path src-tauri/Cargo.toml` — 신규 export 단위
   테스트 (`test_csv_rfc4180_escape`, `test_sql_identifier_quoting`,
   `test_extended_json_objectid`, `test_streaming_100k_rows`,
   `test_export_cancellation_removes_partial_file`) 가 green.
8. **Static (Generator-recorded, Evaluator re-runs)**:
   - `grep -nE 'data-testid="export-button"|export_grid_rows'
     src/components/shared/ExportButton.tsx src/lib/tauri.ts` — testid +
     IPC 이름 일관 확인.
   - `grep -nE '"\$oid"|"\$date"|"\$binary"|"\$numberDecimal"'
     src-tauri/src/commands/export.rs` — Extended JSON 키 4 종 모두 출현.
   - `grep -nE 'csv = "1"' src-tauri/Cargo.toml` — 의존성 추가 확인.
   - `grep -RnE 'unwrap\(\)' src-tauri/src/commands/export.rs` — 0 (테스트
     모듈 외).
   - `grep -RnE 'password' src/components/shared/ExportButton.tsx
     src/lib/export/ src-tauri/src/commands/export.rs` — 0 (Invariant).
   - `git diff src/types/connection.ts` — empty.
   - `git diff src-tauri/src/commands/rdb/query.rs` — `cancel_query` wire
     시그니처 무변동.
9. **Operator browser smoke**:
   1. `pnpm tauri dev`.
   2. PG 연결 → 테이블 열기 → Export → CSV → 파일 저장 → 외부 도구 (numbers / Excel) 열기, 헤더 + 행 + escape 셀 정상 표시 확인.
   3. 같은 데이터로 SQL → 파일 저장 → `psql -f <file> < other_db>` 로 import 가능한지 확인 (단일-테이블 SELECT 추론 가드 포함).
   4. Mongo 컬렉션 → JSON → 파일 저장 → `mongoimport --jsonArray` 가 받아들이는지 smoke.
   5. 쿼리 결과 (JOIN — 다중 source) → SQL 옵션 비활성화, tooltip 노출 확인.
   6. dialog 취소 → toast 없음 확인.
   7. 권한 없는 디렉토리 (e.g. `/`) 선택 → destructive toast 출현 확인.

### Required Evidence

- Generator:
  - 변경 파일 목록 (purpose 한 줄씩).
  - Vitest stdout — `[AC-181-0X]` 케이스 가시.
  - Cargo test stdout — 5개 신규 테스트 (위 §7) pass 가시.
  - 수동 smoke 7-step 결과 (`findings.md` 에 기록).
  - `findings.md` 섹션: 포맷 enum 결정 / 파일명 컨벤션 결정 /
    SQL 단일-테이블 추론 알고리즘 / Extended JSON 모드 (Relaxed) 선택
    이유 / 100k 스트리밍 메모리 측정 결과 / dialog 취소 vs 에러 분기
    결정 / AC→테스트 매핑 / evidence index.
- Evaluator: AC 별 통과 evidence 인용 + 위 #1~#9 재실행 + `git diff`
  invariant 확인.

## Test Requirements

### Unit Tests (필수)

- **`src/lib/export/filename.test.ts`** (AC-181-02):
  - `[AC-181-02a] table context produces "<schema>.<table>_<ts>.csv"`
  - `[AC-181-02b] collection context uses collection name`
  - `[AC-181-02c] query context uses literal "query"`
  - `[AC-181-02d] timestamp is deterministic with injected now`
- **`src/components/shared/ExportButton.test.tsx`** (AC-181-01, 02, 09):
  - `[AC-181-01a] RDB surface menu shows CSV/TSV/SQL`
  - `[AC-181-01b] Mongo surface menu shows JSON/CSV/TSV`
  - `[AC-181-01c] disabledFormats marks SQL as aria-disabled`
  - `[AC-181-02e] save dialog cancel produces no toast`
  - `[AC-181-09a] invoke reject produces destructive toast`
- **세 surface 회귀 테스트**: 1 줄 추가 (`expect(getByRole("button", {name:/export/i})).toBeInTheDocument()`),
  기존 assertion 수정 0.
- **Rust `commands/export.rs` `#[cfg(test)] mod tests`** (AC-181-03..08):
  - `test_csv_rfc4180_escape` — comma/quote/CRLF 셀 케이스
  - `test_csv_utf8_bom_prefix` — 첫 3바이트 `EF BB BF`
  - `test_tsv_strips_tab_in_cell` — 탭 포함 셀 → 공백
  - `test_sql_identifier_double_quote_escape` — 컬럼명에 `"` 포함
  - `test_sql_string_single_quote_escape` — 값에 `'` 포함 → `''`
  - `test_sql_null_literal` — null → `NULL` (no quotes)
  - `test_sql_source_table_inference_single` — 단일 source 통과
  - `test_sql_source_table_inference_multi_disabled` — 다중 source → Err
  - `test_extended_json_objectid_oid_key`
  - `test_extended_json_date_iso`
  - `test_extended_json_decimal128`
  - `test_streaming_100k_rows_writes_all_lines` — `tempfile` 로 검증
  - `test_export_cancellation_removes_partial_file` — token cancel → 부분
    파일 부재 단언
  - `test_null_consistent_across_formats` — 동일 fixture, 4 포맷 골든
  - `test_payload_does_not_log_password` — payload struct 에 password
    필드 부재 (compile-time, 음성 케이스)

### Coverage Target

- 신규/수정 라인: 70% 이상.
- CSV / SQL / Extended JSON 직렬화 함수: 90% 이상 (escape edge cases).

### Scenario Tests (필수)

- [x] Happy path — 세 surface × 4 포맷 export 성공.
- [x] 빈/누락 입력 — 0행 export → 헤더만 있는 파일 + `rows_written: 0`.
- [x] 에러 복구 — Io 에러 → toast + 부분 파일 정리.
- [x] 동시성 — 두 export 가 다른 export_id 로 동시 실행, 한쪽 cancel 이
  다른쪽에 영향 없음.
- [x] 상태 전이 — idle → save dialog → writing → success/cancel/error → idle.
- [x] 회귀 — 세 surface 의 기존 테스트 텍스트 무수정 통과.

## Test Script / Repro Script

1. `pnpm install`; `cargo fetch --manifest-path src-tauri/Cargo.toml`.
2. `pnpm vitest run src/lib/export src/components/shared/ExportButton.test.tsx
   src/components/rdb/DataGrid.test.tsx src/components/document/DocumentDataGrid.test.tsx
   src/components/query/QueryResultGrid.test.tsx`.
3. `pnpm vitest run`.
4. `pnpm tsc --noEmit`.
5. `pnpm lint`.
6. `cargo build --manifest-path src-tauri/Cargo.toml`.
7. `cargo clippy --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings`.
8. `cargo test --manifest-path src-tauri/Cargo.toml`.
9. Static greps (Verification Plan §8).
10. `pnpm tauri dev` → 7-step operator smoke.

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify".
- Untouched: `CLAUDE.md`, `memory/` (decisions index 미변경 — 본 sprint 는
  ADR 추가하지 않음. CSV/SQL/JSON 포맷 선택은 RFC 표준 준수일 뿐 정책 결정
  아님), `src/types/connection.ts`, sprints 175~180 산출물, `package.json`,
  `src-tauri/Cargo.toml` (단 1줄 `csv = "1"` 추가만).
- Merge order: Sprint 180 (cancel-token 레지스트리) 머지 후. Sprint 182
  (Row 인라인 편집 + Preview/Commit/Discard) 와 독립.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–9 in Verification Plan)
- `docs/sprints/sprint-181/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-181/handoff.md` 에 AC 별 evidence 행 (한 행 = 한 AC).
