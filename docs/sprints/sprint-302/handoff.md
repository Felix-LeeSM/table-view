# Sprint 302 — Handoff

## 상태: PARTIAL (Slice A only)

사용자 보고:
> 자동완성 할 때, SELECT 는 2개씩 뜨더라고? column 들도 2개씩 뜰 때가
> 있고. 왼쪽에 뜨는 아이콘이 다른 것이 뜨는 경우가 있더라고? 점검이
> 필요할 것 같아.

## 진단

### "SELECT 가 2번" (Slice A — 해결)

`useSqlAutocomplete.ts:173-179` 가 `dialect`-specific keyword 를
namespace 에 `{ self: { label, type: "keyword", apply: label }, children: {} }`
형태로 inject. lang-sql 의 `sql({ schema, ... })` 은 두 경로를 모두 등록:

1. `schemaCompletion(config)` — ns 의 self-tag entry 를 emit
2. `lang.language.data.of({ autocomplete: keywordCompletionSource(dialect, upperCase) })`
   — dialect.dialect.words 의 keyword 를 emit (`defaultKeyword = (label, type) =>
   ({ label, type, boost: -1 })`)

같은 dialect.language.data.of 경로에서 두 source 가 같은 라벨을 popup
으로 흘려보냄. CodeMirror autocomplete 는 source 간 dedup 을 수행하지
않으므로 popup 에 같은 라벨이 두 번 노출.

원래 ns inject 의 동기 (2026-04-30) 는 lang-sql 의 `nameCompletion`
auto-quote 회피였으나, dialect 의 자체 keyword source 는 `nameCompletion`
을 거치지 않고 plain `{ label, type, boost: -1 }` 을 emit 하므로 quote
회귀 위험이 애초에 없다. 즉 ns inject 는 *불필요한 중복* 이었다.

### "column 2개 / 다른 아이콘" (Slice B — 보류)

원인이 한 가지로 좁혀지지 않음. 가설:

- ns 의 column children 이 여러 entry point (qualified `public.users`,
  bare `users`, quoted `"public"."users"`, fully-quoted) 로 동일 namespace
  객체를 참조해 lang-sql 의 schemaCompletionSource 가 같은 column 을
  여러 경로로 emit 가능성.
- 우리 source (update / alias / cte) 의 emit 영역이 lang-sql 이 alias
  map 으로 처리하는 영역과 부분적으로 겹칠 가능성.
- 다른 아이콘은 type 이 다른 두 옵션이 같은 label 로 emit 되는 케이스
  (예: alias self `type: "type"` vs column `type: "property"`).

검증을 위해 Slice B1 으로 `updateColumnCompletion` 의 SELECT 분기 제거
를 시도했으나 sprint-292 의 `sqlCompletionLevel1` Level-1 회귀 가드
(`SELECT * FROM users WHERE | → users 컬럼 노출`) 가 fail. lang-sql 은
`defaultTable` 미지정 시 bare column (alias 없는 WHERE 절) 을 자체
emit 하지 못한다 — 우리 SELECT 분기가 그 영역을 단독 보강하고 있었음.
따라서 SELECT 분기는 *중복이 아니라 보강*. 제거 불가.

`column 2개` 의 정확한 시나리오 (어떤 doc, 어떤 cursor 위치) 가
사용자로부터 추가로 필요. follow-up sprint 에서 다룸.

## 인도물

- `src/hooks/useSqlAutocomplete.ts` —
  - `dbType` 라인의 keyword inject 블록 (173-179) 제거
  - `keywordsForDbType` / `PG_KEYWORDS` / `MYSQL_KEYWORDS` /
    `SQLITE_KEYWORDS` import 제거
  - `dbType` parameter 는 backwards-compat 위해 시그니처 유지 (dead 인자)
  - useMemo deps 에서 `dbType` 제거
- `src/hooks/useSqlAutocomplete.test.ts` — Sprint 302 회귀 가드 1 it:
  - "ns 는 keyword 를 inject 하지 않는다 — lang-sql 의 자체 keyword
    source 책임" — ns 에 SELECT/FROM/WHERE/RETURNING 없음

## 회귀 가드

- vitest: 3354 passed | 10 skipped
- tsc clean
- eslint clean

## Dead code (정리 후보)

- `src/lib/completion/pg.ts`, `mysql.ts`, `sqlite.ts` — 더 이상 import
  되지 않음. `sqlDialectKeywords.ts` / `COMMON_SQL_KEYWORDS` 도 동일.
  follow-up sprint 에서 정리.

## 후속

- column 중복 / 다른 아이콘 케이스 정확한 doc + cursor 위치 수집 →
  ns 다중 entry point 가설 / 우리 source overlap 가설 중 어느 쪽인지
  좁힘 → 패치.
- dead code 정리 (sqlDialectKeywords, completion/{pg,mysql,sqlite}).
