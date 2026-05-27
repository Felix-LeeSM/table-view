---
title: Engineering
type: index
updated: 2026-05-27
task: implementation, refactor, bug-fix, review
---

# Engineering

코드 구조와 코드 작성 규칙을 읽는 방이다. 제품 상태/방향은 `docs/product` 와
`docs/ROADMAP.md` 를 본다.

## 방 지도

- [architecture](./architecture/memory.md) — 기술 스택, 모듈 구조, IPC, 상태 흐름
- [conventions](./conventions/memory.md) — Rust/TS/React/test/refactor 작성 규칙

## 진입 규칙

- 구조를 이해하거나 모듈 경계를 바꾸면 [architecture](./architecture/memory.md) 먼저.
- 코드를 작성, 테스트, 리팩토링하면 [conventions](./conventions/memory.md) 먼저.
- 과거 ADR/incident 는 기본 탐색 대상이 아니다. 필요할 때만
  `docs/archives/decisions/`, `docs/archives/incidents/` 를 historical context 로 본다.
