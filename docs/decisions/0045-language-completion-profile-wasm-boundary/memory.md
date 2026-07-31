---
id: 0045
title: language completion — dialect profile + WASM hot-path boundary
status: Accepted
date: 2026-05-21
---

**결정**: query editor 자동완성은 "DBMS dialect profile + shell layer +
provider pipeline" 으로 모델링한다. Cursor hot path 의 parse/context/
candidate 생성은 Rust/WASM language core 로 이동 가능하게 설계하고, DB
introspection 은 기존 Tauri IPC + client catalog store 가 계속 맡는다.

**구조**:

1. DBMS SQL dialect 는 `postgresql`, `mysql`, `mariadb`, `sqlite`, `mssql`,
   `oracle`, `ansi` profile 로 표현한다. Profile 은 CodeMirror dialect,
   identifier quote, capability, keyword/function/type/operator vocabulary 를
   가진다.
2. `psql`, `mysql-client`, `sqlite-cli` 같은 shell/meta command 는 SQL
   dialect 가 아니다. `shell` layer 로 분리해 `\dt`, `\G`, `.tables` 가
   SQL keyword/provider 에 섞이지 않게 한다.
3. Completion provider 는 keyword/table/column/function/type/operator/snippet/
   meta-command 같은 재사용 단위로 나눈다. Dialect 차이는 provider 내부
   `if dbType` 분산이 아니라 profile capability/version gate 로 표현한다.
4. WASM completion API 는 `text + cursor + dialect + shell + serverVersion +
   normalized catalog snapshot/slice` 를 입력으로 받는 순수 계산 경계다.
   WASM 은 Tauri state, DB connection, Zustand store 를 직접 알지 않는다.
5. Catalog fetch/cache/invalidation 은 기존 IPC/store 경로가 맡는다. Cache
   miss 시 TS adapter 가 background prefetch 를 예약하고, 다음 completion 에
   갱신된 catalog slice 를 넘긴다.

**이유**:

- 자동완성은 키 입력 hot path 이므로 매번 Tauri IPC 를 타면 UX가 흔들린다.
- PostgreSQL 100% 를 향해 깊게 가더라도 MySQL/MariaDB/SQLite/MSSQL/Oracle
  확장을 막지 않으려면 dialect 차이를 중앙 profile 로 모아야 한다.
- psql/meta command 를 PostgreSQL SQL grammar 에 섞으면 다른 DBMS shell
  지원 시 재사용성이 떨어진다.
- Rust parser crate 는 이미 SQL/mongosh WASM facade 를 가진다. Completion
  core 는 같은 dual-target 원칙을 따르되, catalog I/O 는 앱 infra 에 남긴다.

**주의**:

- Cursor offset 은 UTF-16/byte offset 변환 정책을 API 에 명시해야 한다.
- Completion parser 는 incomplete SQL/MQL 을 다루는 tolerant entrypoint 여야
  하며, 완성 문장 검증용 parser 와 실패 정책이 달라야 한다.
- 큰 catalog 는 매 키 입력마다 통째로 직렬화하지 않는다. 초기 snapshot 은
  허용하되, 장기적으로 `catalogRevision` + active scope/slice 로 축소한다.
- 서버 버전 차이는 `serverVersion` 과 capability gate 로 처리한다.

**관련**:

- ADR 0043 — mongosh parser Rust/WASM SOT.
- `docs/query-language-support.md`.
- `src/lib/sql/sqlDialectProfile.ts`.
