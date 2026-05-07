# Sprint 233 — Findings

작성 일자: 2026-05-07. Owner: harness Generator (Sprint 233).

## Bug #1 — UPDATE SET column autocomplete

### 진단

orchestrator brief 의 가설 A/B/C 중 **A + B 의 합성** 이 root cause:

- **(A) 가 직접 원인**: `useSqlAutocomplete` 가 `ns["public.brief_news_tasks"]`
  (도트 split path) 와 `ns["brief_news_tasks"]` (bare) 까지만 등록하고,
  사용자가 bottom strip 에서 복사해 붙이거나 직접 작성하는 fully-quoted
  form `"public"."brief_news_tasks"` 는 namespace key 로 emit 되지 않았다.
  CodeMirror lang-sql 의 `addNamespaceObject` (`node_modules/@codemirror/
  lang-sql/dist/index.js:507-523`) 는 키를 **`.` 기준으로 split** 해서
  중첩 child 를 만든다. 따라서 `"public"."brief_news_tasks"` 키를 등록하면
  `top.children["\"public\""].children["\"brief_news_tasks\""]` 트리가
  생긴다 — 등록하지 않으면 사용자가 fully-quoted 로 reference 했을 때
  child path 가 비어서 column children 에 도달하지 못한다.

- **(B) 가 보조 원인**: CodeMirror lang-sql 의 `getAliases` (`index.js:
  426-457`) 는 statement 를 walk 하면서 `kw == "from"` 인 경우에만 alias
  추출을 시작한다 (`sawFrom`). UPDATE 문은 FROM 이 없으므로 (PG 의
  `UPDATE … FROM` 형태 제외) `sawFrom = false` 로 끝나, alias 가 등록되지
  않는다. 따라서 `UPDATE table SET <CURSOR>` 에서 cursor 위치의 parents
  는 `[]` 가 되고, top-level 후보 (functions / keywords / tables) 만
  surface 된다 — column 은 직접 qualify 해서 `"public"."brief_news_tasks".
  "col"` 로 reference 해야 popup 이 뜬다.

(B) 는 라이브러리 fork / patch 없이 우회하기 어렵다. 사용자가
`"public"."brief_news_tasks"."col"` 처럼 fully-qualified 로 작성할 때만
column 이 surface 되는 게 현재의 한계인데, 이 경로를 (A) fix 로 살려둔다.

가설 (C) (캐시 미스) 는 graceful 한 동작이 이미 보장되어 있어 별도 fix
불필요 — `tableColumnsCache` 가 비어 있으면 `pickColumns` 가 빈 객체를
반환하고, 사용자가 SchemaTree 노드를 expand 하거나 DataGrid 를 열면
`columnsCache` 가 갱신되어 `useMemo` dep 변화로 namespace 가 재계산된다.
새 AC-233-03 케이스 (`registers fully-quoted key with empty children …`)
가 이 graceful 경로를 명시적으로 고정한다.

### Fix

`src/hooks/useSqlAutocomplete.ts:237-263` 에 `addFullyQuotedAlias`
helper 추가. 기존 `addQuotedAlias` (mixed-case bare name 만 처리) 와
나란히 호출. dialect 가 있을 때만 emit (legacy path 무영향).

emit 형태: `ns['"schema"."table"'] = { self, children }` — `self` 는
CodeMirror 가 label 을 다시 quote 하지 않도록 explicit `apply` 를 가진
completion. children 은 동일 colNs 로 mirror.

### 트레이드오프

- **namespace 크기 증가**: 테이블 N 개당 +1 키 (PG/SQLite). 평균
  schema 당 50-200 테이블 가정 시 +50-200 entry — autocomplete render
  cost 미미하다 (CodeMirror 는 prefix-filter 로 surface 후보를 좁힘).
- **MySQL backtick 도 동일하게 emit** — 사용자 보고는 PG 였지만
  `quoteCharForDialect` 가 dialect 에 따라 backtick / double-quote 를
  반환하므로 MySQL 도 자동으로 `` `db`.`table` `` 형태가 emit 된다.
- **schema 가 mixed-case 인 경우** (`"PublicSchema"."MyTable"`) — 동일
  helper 가 양쪽을 quote 해서 처리. 별도 분기 없음.

### 잔존 risk

1. **UPDATE alias 추출 한계**: CodeMirror lang-sql 라이브러리 fork
   없이는 `UPDATE table SET <CURSOR>` 에서 column 자동완성을 surface
   할 수 없다. 사용자가 `SET column.<...>` 식으로 qualify 해야 함.
   해결책 후보는 (a) 라이브러리 fork, (b) 별도 source 의 statement
   parser 도입 (e.g. `node-sql-parser`) → 비용 대비 ROI 가 낮아 본
   sprint 에서는 닫지 않는다.

2. **mixed-case + fully-quoted 중복 entry**: mixed-case bare name 인
   경우 `addQuotedAlias` 가 `"MyTable"` 을 emit 하고 별도로
   `addFullyQuotedAlias` 가 `"public"."MyTable"` 도 emit 한다 — 둘 다
   다른 path 라 충돌 없음.

3. **MongoDB 등 quoteChar 부재 dialect**: `quoteCharForDialect` 의
   fallback 이 ANSI double-quote 라 MongoDB query tab 에서는
   `useSqlAutocomplete` 자체가 호출되지 않음 (MongoQueryEditor 별도
   훅) — 영향 없음.

## Bug #2 — Bottom-strip syntax highlighting

### 진단

`src/components/rdb/DataGrid.tsx:495-505` 의 plain `<code>{data.executed_query}
</code>` 가 Sprint 227 도입된 `SqlSyntax` 컴포넌트로 교체되지 않은 채
남아 있던 누락. 단순 substitution.

`sqlTokenize.ts:213-220` 검증 결과 — `"…"` 는 이미 `identifier` kind 로
정확히 토큰화 (string 으로 오인 안 됨). `'…'` 만 string 으로 처리. 따라서
PG-double-quoted identifier 는 `text-foreground` (identifier 색상) 로
렌더된다. 이 분기를 신규 테스트 AC-233-04 (c) 가 명시적으로 고정.

### Fix

- `import SqlSyntax from "@components/shared/SqlSyntax"` 추가.
- `<code>` 한 element 를 `<SqlSyntax sql={data.executed_query} className=
  "whitespace-pre-wrap break-all text-xs text-secondary-foreground" />`
  로 교체.

### 회귀 영향

기존 `DataGrid.lifecycle.test.tsx` 의 14번 케이스 ("displays the executed
SQL query") 가 `screen.getByText(/SELECT \* FROM public\.users/)` 를
사용했었다. SqlSyntax 가 SQL 을 token span 으로 split 하므로 이 regex 로
는 더 이상 단일 element 가 매치되지 않는다. 단언을 region 의 `textContent`
포함 검사로 변경 (회귀 의미 보존, 분리 표면만 갱신).

다른 lifecycle 케이스 (toggle visibility / 21 빈 메시지 등) 는 region
ARIA + 클릭 핸들러 만 검사하므로 영향 없음.

### 트레이드오프

- **font 와 색상**: SqlSyntax 가 `font-mono` 를 root 에 강제. 기존
  `<code>` 도 브라우저 default 가 monospace 였으므로 시각 차이 없음.
- **wrapping**: SqlSyntax 의 children 은 inline span 이라 부모의
  `whitespace-pre-wrap break-all` 이 그대로 적용 — 줄바꿈 동작 동일.

## 결정 / 향후 액션

- Sprint 233 은 위 두 fix 만 닫는다.
- `UPDATE alias` 한계는 **별도 sprint 후보**로 두지만 현재 우선순위는
  낮다 (사용자가 fully-qualify 하면 동작; ROI 낮음).
- bottom strip 외 다른 곳 (e.g. error pane, history tooltip) 에 plain
  `<code>` 가 남아 있는지는 별도 audit 대상 — 본 sprint scope 외.

## 참고 (코드 위치)

- `src/hooks/useSqlAutocomplete.ts:237-263` — fix Bug #1.
- `src/components/rdb/DataGrid.tsx:29, 502-510` — fix Bug #2.
- `src/lib/sql/sqlTokenize.ts:213-220` — quoted identifier 분기 (변경 0).
- `src/components/shared/SqlSyntax.tsx` — consumer 만 추가 (body 변경 0).
- `node_modules/@codemirror/lang-sql/dist/index.js:507-523` — namespace
  path split-on-dot 동작 reference.
- `node_modules/@codemirror/lang-sql/dist/index.js:426-457` —
  `getAliases` 의 FROM-only walk reference (가설 B 확인).
