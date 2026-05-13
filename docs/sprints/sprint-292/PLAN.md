# Sprint 292 — Syntax Highlight 강화 + 자동완성 Level-1

## 배경

QueryEditor / MongoQueryEditor 의 토큰화는 이미 dialect-aware 인프라가 깔려
있음 (`databaseTypeToSqlDialect`, `lang-sql` PostgreSQL/MySQL preset,
`updateColumnCompletionSource`). 하지만 사용자 체감은 "기능이 약하다, DDL 도
지원 안 한다" — 실제 원인은 두 가지로 분리:

1. **highlight 색 풀이 약함**: CodeMirror 의 `defaultHighlightStyle` 은
   keyword / type / string / function / number 를 거의 같은 모노톤으로 렌더 →
   `CREATE TABLE users (id BIGSERIAL PRIMARY KEY)` 같은 DDL 도 색 차이로
   보이지 않아 "highlight 없음" 으로 인식됨.
2. **Mongo property vs BSON operator 가 같은 색**: lang-json 은 property
   key 를 일반 string 으로만 처리. `$eq` / `$gt` 같은 operator 가 키워드로
   부각되지 않음.

자동완성도 사용자 요구: UPDATE / JOIN / subquery / CTE 에서 Tab 키로 잘
풀려야 함. 외부 IDE (DataGrip / TablePlus) 수준. 이 sprint 는 그 중 가장
보편적인 Level-1 (기본 SELECT/UPDATE/INSERT/WHERE/ON 위치의 column 자동
완성 완성도 검증) 까지 다룸.

## 분석

### Slice 1 — 커스텀 HighlightStyle (SQL + Mongo 공유)

`@codemirror/language` 의 `HighlightStyle.define([{ tag, class | color }])`
로 tag 별 색을 강제. `@lezer/highlight` 의 `tags` 를 import 해서 다음 tag
에 우리 design-token 기반 색을 매핑:

- `tags.keyword` → `--primary` 계열 (예: SELECT, CREATE, JOIN, WHERE).
- `tags.typeName` → 청록 (예: BIGSERIAL, JSONB, VARCHAR, LONGTEXT).
- `tags.string` → 주황 (single/double quoted literal).
- `tags.number` → 호박 (정수/실수 리터럴).
- `tags.function(tags.variableName)` → 핑크 (sum / count / json_build_object).
- `tags.comment` → muted-foreground.
- `tags.operator` → 보라 (=, <, >, AND, OR, NOT, IN).
- `tags.bracket` → 기본 foreground.
- `tags.propertyName` → foreground + bold (JSON property key).

SqlQueryEditor / MongoQueryEditor 둘 다 같은 `viewTableHighlightStyle` 을
mount → 일관된 시각 톤.

### Slice 2 — Mongo BSON operator overlay

`@codemirror/lang-json` 위에 stream-language overlay 또는 view plugin 으로
BSON operator (`$` 로 시작하는 property key) 를 `tags.keyword` 토큰으로
재분류. 화이트리스트 셋:

```
$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $not, $nor,
$exists, $type, $expr, $regex, $options, $size, $all, $elemMatch,
$set, $unset, $inc, $push, $pull, $addToSet, $pop, $rename,
$match, $project, $group, $sort, $limit, $skip, $lookup, $unwind,
$count, $facet, $sum, $avg, $min, $max, $first, $last
```

옵션 1: ViewPlugin + Decoration (정규식 기반, 가장 가볍다).
옵션 2: stream parser overlay (StreamLanguage.define + tokenize).

**권장: 옵션 1**. Decoration 한 줄 정규식이면 끝, lang-json 의 AST 손대지
않음.

### Slice 3 — 자동완성 Level-1 검증 + 보강

현재 인프라:

- `useSqlAutocomplete` → `SQLNamespace` (테이블/컬럼/함수/키워드 후보).
- `lang-sql({ dialect, schema })` → 기본 `schemaCompletionSource` (FROM
  뒤 테이블 + table.column 인식, FROM alias 도 단일 테이블 범위에서 됨).
- `updateColumnCompletionSource` → `UPDATE users SET <cursor>` /
  `INSERT INTO users (<cursor>)` 보강.

검증:

1. `SELECT * FROM users WHERE <cursor>` → users 컬럼이 나오는지.
2. `SELECT u.<cursor> FROM users u` → alias 인식.
3. `SELECT * FROM users WHERE id IN (<cursor>` → 컬럼 후보.
4. `DELETE FROM users WHERE <cursor>`.
5. `INSERT INTO users (id, <cursor>)`.
6. Tab 키로 후보 accept.

빠진 케이스 발견 시 `updateColumnCompletionSource` 패턴으로 dialect data
extension 추가.

회귀 가드: 새 단위 테스트 — fixture schema + 위 6 시나리오 에서 `completion
sources` 호출 결과 후보에 기대 column 이 포함되는지.

## 슬라이스 분할

| Slice | 작업 | 회귀 가드 |
|-------|------|---------|
| 1 | `viewTableHighlightStyle` 생성 + 두 에디터 wire | 토큰 클래스 별 색 snapshot (test util) |
| 2 | Mongo `$operator` Decoration overlay | `MongoQueryEditor` 토큰 단위 테스트 |
| 3 | 자동완성 6 시나리오 검증 + 빠진 곳 보강 | 시나리오별 completion 후보 단위 테스트 |

## 의존성 / 호환성

- 신규 npm dep 없음 (`@codemirror/language` / `@codemirror/view` 이미 있음).
- `@lezer/highlight` 도 `@codemirror/language` transitive — 직접 import 가능.

## 위험

1. **defaultHighlightStyle 제거 시 fallback** — `syntaxHighlighting(default…
   , { fallback: true })` 는 tag 미정의 시 작동. 우리 style 을 primary 로
   두고 fallback 으로 default 를 함께 등록.
2. **다크/라이트 모드** — design-token (CSS variable) 기반 색만 사용 →
   테마 자동 추종.
3. **JSON 일반 string 이 BSON operator overlay 에 잡힘** — 정규식을
   `"\$\w+"` (property key 위치) 로 한정 + property key syntax-node 위치
   검사로 false positive 방지.

## 일정

- Slice 1: ~30 min. tag 매핑 + viewer wire.
- Slice 2: ~20 min. Decoration overlay + 토큰 테스트.
- Slice 3: ~40 min. 6 시나리오 단위 테스트 + 빠진 곳 보강.

## 후속 sprint (별도)

- **Sprint 294 — 자동완성 Level-2 (alias-aware JOIN)**: `FROM users u JOIN
  orders o ON o.<cursor>` 에서 `o.` 가 orders 컬럼으로 풀리도록. lang-sql
  의 alias 추론 한계 (다중 join) 검증 후 자체 보강.
- **Sprint 295 — 자동완성 Level-3 (CTE / derived subquery)**: `WITH t AS
  (SELECT ...) SELECT t.<cursor>` 에서 t.column 추론. mini-parser 필요할
  가능성.
