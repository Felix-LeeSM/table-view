# Sprint 305 — BigInt-safe stringify audit

**날짜**: 2026-05-14
**범위**: ADR 0026 의 BigInt / Decimal cell type 이 raw `JSON.stringify` 에
흘러가 throw / `{}` 로 망가지던 callsite 일괄 정리.

## 사용자 보고

> `TypeError: JSON.stringify cannot serialize BigInt`. datagrid 를 연
> 상태에서 아예 굳어버렸는데...

## 진단

ADR 0026 (Sprint 261) — PG `bigint`/`numeric` 과 Mongo `Int64`/`Decimal128`
은 wire 에서 string token, frontend 에서 `BigInt(...)` / `new Decimal(...)`
로 wrap. wrap 은 *top-level* row cell 에만 적용.

DataGrid 마운트 시점 freeze:

- `DataGridTable/DataRow.tsx:43` `renderCellTitle` 이 모든 셀의 tooltip
  title 로 호출 — cell 이 object 이고 그 *안* (nested) 에 BigInt 가 있는
  경우 raw `JSON.stringify(cell, null, 2)` 가 `TypeError` throw → React
  Error Boundary 없이 mount path 가 멈춤.
- top-level BigInt 셀은 `typeof === "bigint"` 가드로 우회되지만, JSONB /
  Mongo document 안 큰 정수 등 nested BigInt 가 들어오는 경로는 회피 안
  됐다.

raw `JSON.stringify` callsite 가 cell 값을 받는 곳을 광범위 audit — DataGrid
hot path 외에도 Copy format / Quick Look / Cell Detail / BLOB viewer /
Bson tree / Mongo insert preview / new-row insert SQL 까지 6+ 곳이 동일
회귀 가능성. 사용자 보고는 mount-time freeze 라서 가장 hot 한 path
(`renderCellTitle`) 가 직격이지만, 다른 path 도 BigInt cell 을 만나면
조용히 throw 하거나 (`safeStringifyCell` 가 catch 해 "[unserializable]" 로
emit) 의도와 다른 출력을 만든다.

## 변경

### `src/lib/jsonCell.ts`

`safeStringifyCell(value, indent?)` — 두 번째 인자 `indent` 추가. 기존
호출부 ( `safeStringifyCell(value)` ) 는 compact stringify 그대로. 새
호출부는 `safeStringifyCell(value, 2)` 로 pretty-print. BigInt/Decimal
replacer 는 두 모드 모두 동일.

### callsite swap

- `src/components/datagrid/DataGridTable/DataRow.tsx`
  - `renderCellTitle` — nested BigInt 가드. `JSON.stringify(cell, null, 2)`
    → `safeStringifyCell(cell, 2)`. top-level BigInt 분기 명시 추가.
- `src/components/datagrid/CellDetailDialog.tsx`
  - `renderCellText` — Decimal / BigInt 명시 분기 + object 는
    `safeStringifyCell(data, 2)`.
- `src/components/datagrid/useDataGridEdit.ts`
  - `cellToEditString` / `cellToEditValue` — object branch
    `safeStringifyCell(cell, 2)` 로 swap.
- `src/components/datagrid/BlobViewerDialog.tsx`
  - object branch + 신규 BigInt branch — `safeStringifyCell(data)`.
- `src/components/datagrid/sqlGenerator.ts`
  - `normalizeNewRowCell` object branch → `safeStringifyCell(value)`.
  - `buildWhereClause` — Decimal/BigInt 셀이 `String(...)` 으로 `[object
    Object]` 가 되는 잠재 회귀 가드. `literal()` helper 가 `toString` 메서드
    경로로 fallback.
- `src/lib/format.ts`
  - `cellToFlatString` helper 신설 (`rowsToPlainText` / `rowsToCsv` 공유).
  - `rowsToJson` — `safeStringifyCell(objects, 2)`.
  - `escapeSqlValue` — Decimal/BigInt 명시 분기 (unquoted numeric literal).
- `src/components/shared/QuickLookPanel/helpers.ts`
  - `formatCellValue` — Decimal/BigInt 명시 분기 + object 는
    `safeStringifyCell(value, 2)`. JSON 컬럼 reparse 경로도 동상.
- `src/components/shared/BsonTreeViewer.tsx`
  - `canonicalStringify` → `safeStringifyCell(value)`.
  - copy handler 의 pretty-print → `safeStringifyCell(value, 2)`.
- `src/components/document/DocumentDataGrid.tsx`
  - `insertOne` history sql preview → `safeStringifyCell(record)`.
  - cell render — BigInt 명시 분기 + `safeStringifyCell(cell)`.

### 회귀 가드

- `src/lib/jsonCell.test.ts` +1 case — `safeStringifyCell({…, BigInt}, 2)`
  의 indent 인자 동작.
- `src/components/datagrid/useDataGridEdit.cellToEditValue.test.ts` +1
  case (`[Sprint 305]`) — nested BigInt 가 든 object 가 와도 throw 없이
  pretty JSON 으로 emit. mount-time freeze 의 회귀를 단위 레벨에서 차단.

## 검증

```
pnpm vitest run                    # 275 files / 3359 passed | 10 skipped (was 3357; +2 sprint-305)
pnpm tsc --noEmit                  # clean
pnpm lint                          # clean
```

## 후속

- Sprint 304 — autocomplete column = table dup 정공법 (보류 중).
- Quick Look JSON 컬럼 reparse 경로의 indent 옵션은 사용자 보고 받기
  전에는 변경 없음 (현재 동작 유지).
- BLOB viewer 의 hex/binary 분기에 BigInt encoding 정책 — 별도 사용자
  요청 없으면 toString digit 출력 유지.
