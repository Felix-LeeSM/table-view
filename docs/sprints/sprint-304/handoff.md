# Sprint 304 — Autocomplete column = table dup 해소

**날짜**: 2026-05-14
**범위**: lang-sql 의 `schemaCompletionSource` 를 wrap 해서 column-only
컨텍스트에서 table 후보 emit 제거.

## 사용자 보고

> column 들도 2개씩 뜰 때가 있고. 왼쪽에 뜨는 아이콘이 다른 게 뜨는
> 경우가 있더라고? (스크린샷: `t status` + `□ status` / `t style` +
> `□ style` 등)

## 진단 (Sprint 302 handoff 가설 확정)

`useSqlAutocomplete` 가 ns top-level 에 `ns["public.users"] = colNs` +
`ns["users"] = colNs` 형태로 *컬럼명과 동명일 수 있는 table key* 를
등록. lang-sql 의 `schemaCompletionSource` 는 ns top-level key 를 *모든
cursor 컨텍스트* 에서 `type: "type"` (`t` 아이콘) 으로 emit — `FROM`
자리뿐 아니라 `WHERE` / `SET` / column-list 자리도 포함. 우리
`updateColumnCompletionSource` / `aliasColumnCompletionSource` /
`cteColumnCompletionSource` 가 같은 라벨의 column 을 `type: "property"`
(`□` 아이콘) 으로 emit. CodeMirror autocomplete 는 source 간 dedup 을
하지 않으므로 같은 라벨이 popup 에 두 번 노출.

사용자 DB 에 column `status` 와 동명 table 또는 동명 컬럼이 다른 schema
에 존재할 때 가시화.

## 변경

### 신규 — `src/lib/sql/cursorClause.ts`

`detectCursorClause(state, pos): "column-only" | "table-allowed"`

- enclosing `Statement` 추출 후 cursor 직전 마지막 `Keyword` 를 스캔.
- `column-only`: `SET` / `WHERE` / `BY` / `HAVING` / `ON` / `USING` /
  `SELECT` / `RETURNING` 직후.
- `table-allowed`: `FROM` / `JOIN` / `UPDATE` / `INTO` 직후.
- Keyword scan 이 잡지 못한 토큰 (예: 일부 dialect 에서 `RETURNING` 이
  Identifier 로 토큰화) 은 textual `lastWord` regex fallback.
- 두 단계 모두 실패하면 `table-allowed` (safe over-suppression 회피).

회귀 가드: `cursorClause.test.ts` 14 case — WHERE / SET / SELECT / ORDER
BY / GROUP BY / HAVING / ON / RETURNING / FROM / JOIN / INSERT INTO /
UPDATE / DELETE FROM / 빈 doc.

### 신규 — `src/lib/sql/schemaCompletionWrapper.ts`

`wrappedSchemaCompletionSource(getSchema, dialect): CompletionSource`

- inner `schemaCompletionSource({schema, dialect})` 를 lazy 생성 — lang-sql
  의 alias map (FROM 절이 이미 있는 statement 의 `<table> <alias>` 매핑)
  은 inner source 가 그대로 수행.
- inner 결과를 `applyFilter` 로 후처리:
  - `clause === "table-allowed"` → 결과 그대로 통과.
  - `clause === "column-only"` → `type === "type"` (table) 옵션 제거.
- inner 가 sync / async 둘 다 반환 가능 (lang-sql 6.x) — Promise 검출 후
  branch.

회귀 가드: `schemaCompletionWrapper.test.ts` 5 case — WHERE table 제거 /
SET table 제거 / FROM table 유지 / JOIN table 유지 / undefined ns 시 null.

### `src/components/query/SqlQueryEditor.tsx`

`sqlLanguage({ dialect, schema: ns, upperCaseKeywords: true })` 의 `schema`
인자 제거 → lang-sql 의 자동 schemaCompletion wire 끄기. 대신
`dialect.language.data.of({ autocomplete: wrappedSchemaCompletionSource })`
로 직접 등록. lang-sql 의 keywordCompletionSource 는 `sql({})` 의 자동
wire 가 그대로 처리.

## 검증

```
pnpm vitest run                    # 277 files / 3378 passed | 10 skipped (was 3359; +19 sprint-304)
pnpm tsc --noEmit                  # clean
pnpm lint                          # clean
```

회귀 가드 무손실: Sprint 292/294/295 (autocomplete Level 1-3) +
`updateColumnCompletion` / `aliasColumnCompletion` / `cteColumnCompletion`
85 case 모두 GREEN.

## 후속

- 빈도가 낮은 SQL keyword (RETURNING, FETCH, OFFSET, etc.) 의 dialect 별
  토큰화 차이가 추가 발견되면 `cursorClause.ts` 의 set 확장.
- ns 자체 구조 (`Sprint 268` policy A) 의 column emit 정책은 그대로 유지
  — bare key + qualified key 모두 보존되어 alias 검출이 동일 동작.
