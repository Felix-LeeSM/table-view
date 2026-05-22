---
title: pre-push path routing must fail open and include old paths
type: lesson
updated: 2026-05-22
task: git, hook, pre-push, path-routing, coverage
surface: lefthook.yml, scripts/hooks/pre-push-path-router.sh, scripts/hooks/test-pre-push-path-router.sh
---

# pre-push path routing must fail open and include old paths

상황: pre-push hook 이 매 push 마다 전체 frontend/Rust stack 을 실행하면 docs-only
push 비용이 과해진다. Sprint 431 은 outgoing commit range 의 changed path 로
필요한 gate 만 고르는 routing layer 를 둔다.

pre-commit 은 이미 Lefthook `glob` 기반 staged-file routing + parallel 실행을
쓰므로 별도 router 로 대체하지 않는다. pre-push 만 push-time ref/range 를 해석하는
router 가 필요하다.

원인: 비용 최적화가 path classification 에 기대면 누락 위험도 같이 생긴다.
특히 new branch 는 upstream ref 가 없을 수 있고, rename/delete 는 새 path 만
보면 old source path 를 놓친다. hook/workflow/unknown path 를 docs-only 처럼
취급하면 가장 위험한 변경에서 검증을 줄이게 된다.

재발 방지:

- signed commit 검증과 TDD-cycle guard 는 path 와 무관하게 항상 실행한다.
- docs-only 만 full frontend/Rust stack 을 생략한다.
- frontend 는 TS typecheck/lint/tests/coverage, Rust 는 cargo check, cargo
  deny, cargo machete, llvm-cov coverage 로 라우팅한다. mixed 는 둘 다 실행하며
  parallel 실행이 가능한 route 로 둔다.
- hook/workflow/unknown 은 fail open to full stack 으로 처리한다.
- changed-path 수집은 docs/frontend/Rust/mixed/workflow/unknown/new branch/rename/delete
  guard 를 포함하고, rename/delete 는 old path 와 new path 를 모두 classification
  input 으로 삼는다.
