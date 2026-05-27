---
id: 0043
title: mongosh parser — Rust/WASM single parser with TS policy adapter
status: Accepted
date: 2026-05-20
supersedes: 0029
---

**결정**: Phase 28 mongosh expression parsing 의 syntax source of truth 는
`src-tauri/mongosh-parser-core/` Rust parser + WASM facade 로 통일한다.
`src/lib/mongo/mongoshParser.ts` 는 recursive parser 를 보유하지 않고,
WASM parser 결과 위에서 method whitelist / cursor-chain validity / legacy
error taxonomy 만 적용하는 TS policy adapter 로 둔다.

**이유**:

1. Sprint 401 이 이미 `runCommandParser` 와 Toolbar 의 sync classifier 를
   Rust/WASM parser 로 옮겼다. `useQueryExecution` 만 1000L TS parser 를
   계속 쓰면 두 grammar 가 drift 한다.
2. Rust parser 는 `mongoshAst.test.ts` 의 admin-command / collection-command /
   BSON literal matrix 로 보호된다. dispatch adapter 는 whitelist 와
   Safe Mode 전 단계 validation 에 집중하는 것이 더 작은 책임이다.
3. Toolbar render path 는 여전히 sync surface 가 필요하다. WASM eager-load +
   sync facade 결정은 유지하고, `parseMongoshExpression` 도 그 facade 위에서
   동작하게 해 async parser state 를 UI hook 로 확산하지 않는다.

**트레이드오프**:

- **+** 중복 recursive-descent parser 제거. grammar 수정은 Rust crate 한 곳만
  보면 된다.
- **+** 기존 Phase 28 dispatch API 는 보존되어 `useQueryExecution` 의 넓은
  refactor 를 피한다.
- **−** TS adapter 에 method whitelist 와 cursor-chain policy 가 남는다.
  이는 syntax parser 가 아니라 product policy 이므로 허용한다.
- **−** BSON literal surface 는 Sprint 401 parser semantics 를 따른다. 예:
  `UUID(...)` 는 `$uuid`, numeric `NumberLong(123)` 은 문자열 placeholder 로
  허용되고, 값 위치의 bare identifier `undefined` 는 거절된다.

**관련**:

- Supersedes ADR 0029.
- Sprint 401 contract: `docs/sprints/sprint-401/contract.md`
- `src/lib/mongo/mongoshAst/index.ts`
- `src/lib/mongo/mongoshParser.ts`
