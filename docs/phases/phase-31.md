# Phase 31: Language Completion Architecture

> **상태: 진행 (Sprint 420 시작).** ADR 0045 를 구현 계획으로 승격한다.
> 목표는 현 TS/CodeMirror 자동완성을 유지하면서, Rust/WASM completion core 로
> 점진 전환 가능한 multi-dialect boundary 를 고정하는 것이다.

## 배경

현재 자동완성은 기능이 있다. PostgreSQL 은 강하고, MySQL/MariaDB/SQLite 는
사용 가능한 기본 표면이 있으며, MongoDB 는 whitelisted mongosh workflow 에
강하다. 하지만 내부 구조는 TS provider / CodeMirror source / catalog cache 가
섞여 있다. 장기적으로 DBMS dialect 와 shell command 를 확장하려면 request /
result contract 를 먼저 고정해야 한다.

판단 기준: "PostgreSQL 자동완성 품질을 유지하면서 MySQL, MariaDB, SQLite 를
같은 구조로 확장할 수 있는가."

## 결정

- Completion hot path 는 Tauri IPC 를 타지 않는다.
- Catalog fetch 는 background IPC + client store cache 책임이다.
- Rust/WASM core 는 `text`, cursor offset, dialect, shell, serverVersion,
  capabilities, catalog slice 만 받는다.
- Cursor offset 은 UTF-16 과 UTF-8 byte offset 을 함께 싣는다.
- SQL dialect 와 shell/meta command 는 분리한다.
- PostgreSQL 먼저 shadow mode 로 검증하되 request/result shape 은 처음부터
  MySQL/MariaDB/SQLite 를 포함한다.
- MongoDB 는 arbitrary JavaScript 를 지원하지 않는다. 기존 mongosh WASM
  parser / whitelist 정책을 completion context routing 에 연결한다.

## 범위

### Contract surface

- Generic completion item/result.
- SQL completion request builder.
- UTF-16 ↔ UTF-8 byte offset policy.
- `dialect`, `family`, `shell`, `serverVersion`, `capabilities`,
  `catalog.revision`, cache state 포함.

### SQL dialect surface

- PostgreSQL: current parity 유지 후 WASM-first 전환.
- MySQL: backtick, `LIMIT offset,count`, `ON DUPLICATE KEY UPDATE`,
  `SHOW`, `DESCRIBE`, `USE`, MySQL 함수 후보.
- MariaDB: MySQL family 공유 + MariaDB delta profile.
- SQLite: `PRAGMA`, `WITHOUT ROWID`, `AUTOINCREMENT`, SQLite 함수 후보.

### Shell/meta surface

- `psql`: `\d`, `\dt`, `\dv`, `\df`, `\copy`.
- `mysql-client`: `\G`, `source`, `delimiter`.
- `sqlite-cli`: `.tables`, `.schema`, `.mode`, `.headers`.
- Shell command 는 SQL grammar 에 섞지 않는다.

### Mongo surface

- collection/method/operator/stage/BSON tag completion 유지.
- mongosh WASM classifier 로 admin command / collection method context routing
  정리.
- arbitrary JS, variables, callbacks, multiple statements 는 계속 out of
  scope.

## Slice 분해

| Slice | Sprint | 범위 |
|---|---:|---|
| A | 420 | Contract + SQL request builder + PLAN/phase 문서화 |
| B | 421 | CodeMirror adapter shadow path. current TS result 유지, request만 병렬 생성 |
| C | 422 | PostgreSQL WASM completion core v0 |
| D | 423 | PostgreSQL parity gate + WASM-first 전환, TS fallback 유지 |
| E | 424 | MySQL/MariaDB dialect closure |
| F | 425 | SQLite dialect + sqlite-cli shell layer |
| G | 426 | Mongo completion classifier alignment |
| H | 427 | TS helper cleanup + docs support matrix 갱신 |

## Acceptance Criteria

- **AC-31-01** Completion request/result contract 가 SQL/Mongo 공통 방향을
  가진다.
- **AC-31-02** PostgreSQL/MySQL/MariaDB/SQLite request shape 이 동일하다.
- **AC-31-03** Cursor offset 은 UTF-16 + UTF-8 byte offset 으로 고정된다.
- **AC-31-04** Completion hot path 에 신규 IPC 가 없다.
- **AC-31-05** PostgreSQL shadow mode 에서 current TS result 와 WASM result 를
  비교할 수 있다.
- **AC-31-06** MySQL/MariaDB/SQLite dialect delta 는 profile/capability 로
  표현되고 provider 내부 `dbType` 분산을 늘리지 않는다.
- **AC-31-07** Shell/meta command 는 SQL keyword vocabulary 에 들어가지 않는다.
- **AC-31-08** Mongo completion 은 whitelist + WASM classifier 정책을 유지한다.
- **AC-31-09** 각 slice 는 focused Vitest 와 `tsc --noEmit` 를 통과한다.

## Out of Scope

- 서버가 지원하는 모든 SQL 문법을 completion 이 100% 이해하는 것.
- 신규 DB adapter 구현.
- arbitrary mongosh JavaScript.
- runtime query execution 변경.

## 위험

- **R31.1** Catalog 가 큰 연결에서 request 직렬화 비용 증가. 대응:
  `catalogRevision` + active scope/slice 로 축소.
- **R31.2** UTF-16/UTF-8 offset drift. 대응: emoji/CJK 포함 단위 테스트.
- **R31.3** MySQL/MariaDB divergence 과소평가. 대응: MariaDB profile 은 별도
  dialect id 유지.
- **R31.4** Shell command 를 SQL grammar 에 섞는 회귀. 대응: shell profile
  test 로 keyword vocabulary 오염 방지.

## Phase Exit Gate

- PostgreSQL WASM-first completion 이 current TS fallback 과 parity green.
- MySQL/MariaDB/SQLite dialect-specific completion smoke green.
- Shell/meta command completion 이 SQL keyword/provider 와 분리.
- Mongo whitelisted completion regression green.
- `docs/query-language-support.md` support matrix 최신화.

## 관련

- ADR 0045:
  [`memory/decisions/0045-language-completion-profile-wasm-boundary/memory.md`](../../memory/decisions/0045-language-completion-profile-wasm-boundary/memory.md)
- Support matrix: [`docs/query-language-support.md`](../query-language-support.md)
- Sprint 420: [`docs/sprints/sprint-420/contract.md`](../sprints/sprint-420/contract.md)
