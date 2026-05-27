---
title: Query language architecture
type: memory
updated: 2026-05-27
surface: src/types/queryLanguage.ts, src/lib/sql/**, src/lib/mongo/**, src-tauri/*-parser-core/**
task: query-language, parser, completion, safe-mode
trigger:
  signal: queryLanguage 추가 / parser owner 변경 / completion 변경 / Safe Mode 변경
  layer: index
---

# Query Language Architecture

Query language ownership 은 `src/types/queryLanguage.ts` 의
`QUERY_LANGUAGE_REGISTRY` 가 고정한다. Active `DataSourceProfile.languages` 가
참조하는 언어는 registry 에 active owner record 를 가져야 한다.

## Ownership Rules

- `sql` 과 `mongosh` hot path parser/completion/safety 는 Rust/WASM language core 가
  SOT 다.
- TypeScript fallback mirror 는 compatibility/loading fallback 이며 SOT 가 아니다.
- `redis-command` 와 `search-dsl` 은 profile safety policy 와 future language-core
  contract 아래 둔다. Runtime/support claim 은 fixture/live evidence 로 좁힌다.
- Deferred ids (`cql`, `partiql`, `cypher`, `gql`, `gremlin`, `vector-query`,
  `stream-command`) 는 future owner placeholder 를 가진다. Active profile 이
  silently parser/completion vocabulary 를 도입하면 안 된다.

## Support Boundary

- Server execution 은 최종 DB 서버가 판단한다.
- Client parser, completion, Safe Mode 는 클라이언트가 구조적으로 이해하는
  부분집합만 지원한다.
- "100% completion coverage" 는 현재 UI 가 surface 하는 vocabulary group 이
  Rust/WASM SOT 에 빠짐없이 있음을 뜻한다. 전체 dialect semantics 보장을 뜻하지
  않는다.
- Arbitrary MongoDB JavaScript shell execution 은 금지한다. Whitelisted `db...`
  expression 만 parse 해서 typed IPC command 로 dispatch 한다.

## Completion Architecture

```text
Tauri IPC -> catalog introspection -> client catalog store
  -> TS completion request adapter -> Rust/WASM language core
  -> CodeMirror Completion[]
```

- Completion hot path 는 IPC 를 타지 않는다. IPC 는 background catalog fetch 에 쓴다.
- WASM request 는 `text`, cursor offset, dialect/shell, serverVersion,
  capability, normalized catalog slice 를 명시한다.
- Built-in keyword/function/operator/shell vocabulary 는 Rust/WASM core 가 소유한다.
- Extension/plugin/module vocabulary 는 detected capability pack 으로만 활성화한다.
- Large catalog 는 active scope/prefix 기반 slice 로 줄여 전달한다.
- Shell/meta command 는 SQL grammar 에 섞지 않는다.

## Reference

Current product-facing support boundaries live in
[docs/product/query-language-support.md](../../../../docs/product/query-language-support.md).

## Related

- [data-source architecture](../data-source/memory.md)
- [ADR 0045](../../../../docs/archives/decisions/0045-language-completion-profile-wasm-boundary/memory.md)
