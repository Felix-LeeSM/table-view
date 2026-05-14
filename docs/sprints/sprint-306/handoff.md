# Sprint 306 — BigInt stringify 회귀 가드 + ESLint 차단

**날짜**: 2026-05-14
**범위**: Sprint 305 핫픽스로 고친 모든 callsite 에 BigInt/Decimal 회귀
테스트 추가 + cell-domain 디렉토리에서 raw `JSON.stringify` 를 `no-
restricted-syntax` 로 영구 차단.

## 배경

Sprint 305 는 DataGrid mount-time freeze 의 핫픽스였다. 원인은
`renderCellTitle` (DataRow.tsx:43) 의 raw `JSON.stringify(cell, null, 2)`
가 nested BigInt 셀 만나면 throw → React render throw → frozen UI. 다른
10 개 cell-touching 함수 (`CellDetailDialog`, `BlobViewerDialog`,
`BsonTreeViewer`, `useDataGridEdit`, `sqlGenerator`, `format`,
`QuickLookPanel/helpers`, `rawQuerySqlBuilder`, `mqlGenerator`) 도 동일
패턴이라 같이 고쳤다. 그러나 회귀 가드가 없으면 동일 안티패턴이 다시
들어올 수 있어 본 sprint 가 (a) 각 callsite 회귀 케이스, (b) ESLint
구조 검사로 근본 차단을 한다.

## 변경

### 회귀 가드 (+23 case)

- `src/lib/format.test.ts` — `rowsToPlainText` / `rowsToJson` /
  `rowsToCsv` / `rowsToSqlInsert` 4 함수 × BigInt scalar + nested object
  + Decimal scalar 케이스 (9 case).
- `src/components/datagrid/sqlGenerator.test.ts` — `generateSql` INSERT
  with nested BigInt object + DELETE WHERE BigInt pk (2 case).
- `src/components/datagrid/CellDetailDialog.test.tsx` — top-level BigInt
  + nested BigInt (2 case).
- `src/components/datagrid/BlobViewerDialog.test.tsx` — BigInt scalar +
  nested BigInt (2 case).
- `src/components/shared/BsonTreeViewer.test.tsx` — BigInt leaf + BigInt
  array (2 case).
- `src/components/shared/QuickLookPanel/helpers.test.ts` (신규) —
  `formatCellValue` BigInt / Decimal / nested BigInt / JSON column /
  NULL (5 case).
- 기존 `jsonCell.test.ts` / `useDataGridEdit.cellToEditValue.test.ts`
  의 sprint-305 case 는 이미 GREEN.

### 잔여 callsite 수정

`pnpm lint` 가 본 sprint 의 새 규칙으로 5 추가 위반을 발견 (DocumentBulk
{Delete,Update}Dialog + useMongoBulkOps × 3). 모두 MongoDB filter / patch
preview 였고, 사용자가 입력한 query AST 에 BigInt sentinel 이 들어올
수 있으므로 `safeStringifyCell` 로 마이그레이션 (eslint-disable 회피).

`src/lib/mongo/mqlGenerator.ts:117` + `src/lib/sql/rawQuerySqlBuilder.ts
:29` 의 raw stringify 도 sprint-305 audit 에서 누락되었던 callsite — 본
sprint 에서 `safeStringifyCell` 로 마이그레이션.

### ESLint 구조 검사

`eslint.config.js` 에 `no-restricted-syntax` 블록 추가. 스코프:

- `src/components/datagrid/**` (cell render / edit / preview / SQL gen)
- `src/components/document/**` (Mongo equivalent)
- `src/components/shared/QuickLookPanel/**` + `BsonTreeViewer.tsx`
- `src/lib/format.ts` / `src/lib/mongo/mqlGenerator.ts` /
  `src/lib/sql/rawQuerySqlBuilder.ts`

이 디렉토리 안의 `JSON.stringify(...)` 호출은 모두 error. 본 wrapper
인 `src/lib/jsonCell.ts` 와 `*.test.{ts,tsx}` 는 ignore. 다른 디렉토리
(localStorage persist / session storage / IPC bridge / 에러 로깅 등)
는 패턴 스코프 밖이라 자동 제외.

## 검증

```
pnpm vitest run                    # 278 files / 3401 passed | 10 skipped (was 3378; +23)
pnpm tsc --noEmit                  # clean
pnpm lint                          # clean
```

## 근본 방지 효과

- 다음 PR 가 cell-domain 디렉토리 안에서 raw `JSON.stringify` 를
  새로 도입하면 `pnpm lint` 가 즉시 fail → pre-commit hook 단계에서
  block.
- 의도적 예외 (예: 외부 binary serializer 의 wrapper) 가 미래에 필요하면
  한 줄 `eslint-disable-next-line no-restricted-syntax` + 사유 코멘트
  로 명시 — review 시 그 한 줄이 audit 신호.
- 스코프가 cell-domain 디렉토리에 한정되어 localStorage persist /
  IPC bridge / 에러 로깅 같은 정당한 stringify 는 영향 없음.

## 후속

- 새 paradigm (예: GraphResultGrid) 추가 시 ESLint files glob 확장.
- ADR 0026 (numeric wire-format) 후속 — 추가 cell type (Date,
  BSON ObjectId 등) 도입 시 safeStringifyCell replacer 에 분기 추가
  → 회귀 가드 패턴은 그대로 재사용.
