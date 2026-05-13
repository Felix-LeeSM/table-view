# Sprint 292 — Syntax highlighting + lint 고도화

## 배경

현재 QueryEditor / MongoQueryEditor 는 CodeMirror 6 의 기본 `lang-sql` + `lang-json`
토큰화에만 의존. 사용자가 잘못된 쿼리를 실행하기 직전에 **에디터 안에서**
경고를 받지 못한다.

사용자 요구: `joereynolds/sql-lint`, `simonecorsi/mongodb-query-validator`
류의 라이브러리를 참고해 syntax highlighting 을 고도화.

## 분석

### CodeMirror 6 lint 인프라

`@codemirror/lint` 패키지가 표준. Diagnostic 객체 (range, severity,
message) 를 반환하는 `linter()` extension 을 등록하면 gutter marker +
hover popup + Cmd+Shift+M ("show all problems") 가 자동으로 동작.

이미 두 에디터가 CodeMirror 6 위에 있어 라이브러리 갈아엎을 필요 없음.

### sql-lint (Joe Reynolds)

- Node CLI. dialect 별 rule (MySQL / PG / Sqlite).
- 핵심 rule:
  - `missing-where` — UPDATE/DELETE without WHERE
  - `mysql-invalid-create-option` — MySQL dialect mismatch
  - `unknown-table` / `unknown-column` — schema 가 있을 때만 가능
  - `syntax-error` — 파싱 실패 위치 마킹
- 의존성: `sqlite3`, `mysql2`, `node-postgres`. CLI 라 그대로는 부적합 —
  핵심 rule 만 dialect-aware 한 정규식 + AST-light 파서로 인라인 포팅.

### mongodb-query-validator (Simone Corsi)

- npm 패키지. `validate(query)` → `{ valid, errors }`.
- JSON5/JSON 입력을 받아 Mongo 표현식 ($eq, $gt, $in, $regex 등)
  validation.
- 의존성 가벼움 (ajv-like). MongoQueryEditor 에 직접 의존 추가 가능.

## 슬라이스 분할

### Slice A — CodeMirror @codemirror/lint 인프라 마운트

목표: 두 에디터에 빈 linter 등록. gutter / hover 동작 확인.

- `pnpm add @codemirror/lint`
- `QueryEditor.tsx`, `MongoQueryEditor.tsx` 에 `linter()` extension 추가.
- 회귀 가드: 에디터 렌더링 / 키 입력 / 자동완성 회귀 없음.

### Slice B — SQL dialect-aware lint rules (PG / MySQL)

목표: 의존성 없이 핵심 rule 인라인 구현.

- `src/lib/sql/lint/sqlLinter.ts` — `(sql, dialect) => Diagnostic[]`.
- 규칙 1차:
  1. `missing-where` — UPDATE/DELETE WHERE 누락 (raw SQL 분석).
  2. `semicolon-after-block` — `BEGIN…END;` 안 / 밖 구분.
  3. `dialect-mismatch` — PG 에 MySQL 키워드 (`AUTO_INCREMENT`, backtick
     identifier), MySQL 에 PG 키워드 (`SERIAL`, `RETURNING`) 검출.
  4. `dangerous-drop` — `DROP TABLE`/`DROP DATABASE` 경고 (severity warning).
- 회귀 가드: rule 별 unit test (true positive / false positive).

### Slice C — Mongo expression validator

목표: `mongodb-query-validator` 통합 또는 핵심 rule 포팅.

- 옵션 1: `pnpm add mongodb-query-validator` — 외부 의존 추가, 빠른 진입.
- 옵션 2: 핵심 operator 화이트리스트 + JSON5 parse error → Diagnostic 인라인.
- 권장: 옵션 2 — 의존성 minimal 유지 + dialect knob 자유로움.
- 회귀 가드: `$eq` / `$in` 유효, `$bogus` 무효, JSON parse 위치 보고.

### Slice D — Highlighting 강화 (dialect-aware keyword)

목표: CodeMirror SQL highlight 가 모든 dialect 키워드를 한 set 으로 처리
하던 것을 PG / MySQL 별 keyword set 으로 분리.

- `lang-sql` 의 `PostgreSQL`, `MySQL` dialect preset 활용 +
  `keywords:` extra entry 로 우리 환경의 합성 키워드 (예: PG 의 `\c`)
  추가.
- 회귀 가드: 토큰 클래스 단위 snapshot (`tokenAt(pos).type`).

## 의존성 / 호환성

- `@codemirror/lint` 만 신규 dep. 번들 영향 < 8 KB gzip.
- 인라인 SQL linter 는 무의존 → 번들 영향 0.

## 위험

1. **False positive** — UPDATE 안의 부속 SELECT 가 WHERE 가 있다고 본체에
   WHERE 가 없는 걸 못 잡는 경우. AST-light 파서 (재귀 없는 statement
   splitter) 로 1차 statement boundary 만 검출.
2. **성능** — 대형 쿼리 (10k 라인) 에서 lint debounce 필요. CodeMirror
   `linter()` 가 자체 debounce 함 (기본 750ms).
3. **사용자 혼란** — DROP TABLE 경고가 정상 DDL 워크플로를 방해. severity
   warning + 토글 가능한 setting (장기).

## 일정

- Slice A: 1 단계 — 인프라.
- Slice B: 4 rule. rule 당 ~20 min.
- Slice C: validator.
- Slice D: keyword set 보강 (시간 남으면).

## 미해결 결정

1. **외부 의존 vs 인라인 포팅** — `mongodb-query-validator` 의존 추가 여부.
   현재 권장: 인라인 (slice C 옵션 2).
2. **DDL 경고를 default ON / OFF** — TablePlus 는 toast 로 한 번 확인.
   사용자 의견 필요.
3. **MySQL dialect lint 에 keyword AUTO_INCREMENT, ENGINE= 등을 어디까지
   허용** — PG 모드에서만 경고? 또는 어떤 dialect 라도 spec 키워드 외
   사용은 경고? 기본 안: 활성 connection 의 dialect 와 mismatch 시 경고.
