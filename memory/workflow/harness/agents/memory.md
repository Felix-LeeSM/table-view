---
title: Harness agents
type: workflow-rule
updated: 2026-05-26
task: harness, multi-agent, agent-topology, thin-read-pack
trigger:
  signal: /harness run agent 구성 또는 Planner input 구성
  layer: agent-prompt
---

# Harness agents

2026-05-26 grill lock: harness 기본 spawned worker 는 3개로 압축한다.

## 기본 topology

1. `Planner-Contract`: repo memory/docs/code 를 읽고 `spec.md`, `contract.md`,
   `execution-brief.md` 초안을 만든다. Research + planning + contract mapping 을
   한 agent 가 맡는다.
2. `Builder-Delivery`: 구현, 테스트, human-readable handoff, commit, push, PR,
   review finding 반영, user-review 요청을 맡는다. 한 PR 의 write 책임자는 1명이다.
3. `Reviewer`: read-only 검증자. harness `Evaluator` 와 PR `pr-reviewer` 역할을
   통합해 AC evidence 평가, scope/invariant 정합성, PR quality scorecard 를 맡는다.
   코드 수정, commit, push, merge 금지.

Harness `Reviewer` output 과 Builder handoff 는 user review 의 입력이다. user review
완료나 merge 승인은 사용자 채팅의 명시 문구 없이는 만들 수 없다. Reviewer 는
handoff 가 사용자 review 에 충분한지도 평가한다.

Harness 안에서는 `Reviewer` 통합이 [review](../../review/memory.md) 의 별도
`pr-reviewer` spawn 기본값을 좁게 override 한다. Harness 밖의 일반 delivery 는 기존
delivery/review workflow 를 그대로 따른다.

## Conditional Research Scout

`Research Scout` 는 기본 worker 가 아니며 조건부로만 spawn 한다. 다음 경우에만
read-only escalation 으로 추가한다:

- 큰 feature
- 새 subsystem
- SOT 위치 불명
- ADR/memory 충돌 가능성
- Planner-Contract 가 읽을 SOT 를 못 찾는 경우

Research Scout 출력은 Thin Read Pack 후보 목록과 충돌/미확정 요약으로 제한한다.
코드 수정, 설계 결정, contract 작성, pass 선언, PR review 금지.

Spawn trigger 는 아래 중 하나면 충분하다:

1. Thin Read Pack 에 관련 SOT 가 3개 미만.
2. 수정 예상 surface 가 3개 이상.
3. 새 subsystem / 외부 도구 / 보안 / ADR 충돌 신호.
4. Planner-Contract 가 `missing SOT` 를 보고.

## Planner-Contract input

Planner-Contract 에게는 Thin Read Pack 만 전달한다. 목적은 큰 그림 후보를 주되
context dump 를 막는 것이다.

Thin Read Pack 필수 항목:

- `AGENTS.md`
- `memory/index/by-task.md`
- `memory/workflow/harness/memory.md`
- 관련 SOT 파일 링크 목록(memory/docs/ADR)
- 관련 코드 entrypoint 목록

Orchestrator 는 관련 문서 본문을 대량으로 붙이지 않는다. Planner-Contract 가
필요한 파일을 직접 읽고, 읽은 SOT 와 적용 요약을 evidence 후보로 보고한다.

## Prompt mapping

- `planner.md` → `Planner-Contract`
- `generator.md` → `Builder-Delivery`
- `evaluator.md` → `Reviewer`

Prompt 는 operational-thin 실행 계약이다. 정책 이유/예외/결정은
`memory/workflow/harness/` 를 따른다.

## 관련

- [harness](../memory.md) — index
- [principles](../principles/memory.md) — SOT boundary
- [run-ledger](../run-ledger/memory.md) — evidence 반영
- [delivery](../../delivery/memory.md) — delivery owner 원칙
- [review](../../review/memory.md) — PR review 원칙
