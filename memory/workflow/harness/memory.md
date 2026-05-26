---
title: Harness workflow SOT
type: index
updated: 2026-05-26
task: harness, multi-agent, sprint, workflow-sot, read-verified
trigger:
  signal: 사용자가 /harness 요청 또는 agentic workflow 개선 논의
  layer: agent-prompt
---

# Harness workflow SOT

`/harness` 의 source of truth. Skill/prompts/templates 는 실행 wrapper 이고,
본 memory tree 가 설계/운영 규칙을 가진다.

## 방 지도

- [principles](./principles/memory.md) — SOT boundary, 목표, 설계 원칙,
  skill/prompt/template 경계.
- [run-ledger](./run-ledger/memory.md) — `docs/sprints/sprint-N/run.md`,
  evidence-only pass, context budget, AC row granularity.
- [agents](./agents/memory.md) — 3-worker topology, conditional Research Scout,
  Thin Read Pack.

## 핵심 잠금

- 첫 개선 단위는 **run ledger**.
- `run.md` 는 agent context dump 가 아니라 side-channel artifact.
- `pass` 는 evidence-only. agent 자기보고만으로 pass 금지.
- 기본 spawned worker 는 3개: `Planner-Contract`, `Builder-Delivery`,
  `Reviewer`.
- `Research Scout` 는 조건부 spawn.
- Planner-Contract input 은 Thin Read Pack.
- AC evidence 는 AC 1개당 row 1개.

## Artifact 위치

- Sprint artifacts: `docs/sprints/sprint-N/`
- Skill source: `.agents/skills/harness/`
- Brain-specific skill copies: 금지. `.agents/skills/harness/` 를 직접 참조한다.
- Raw audit input: `docs/archives/audits/harness-issues-handoff-2026-05-25.md`

## 관련

- [grill](../grill/memory.md) — 결정 인터뷰 룰
- [implementation](../implementation/memory.md) — implementation phase noise 차단
- [tdd](../tdd/memory.md) — code-profile RED evidence
- [delivery](../delivery/memory.md) — commit/push/PR/review, merge는 user review 후
- [review](../review/memory.md) — PR review 자동 layer + 정성 layer
- [terminology](../../terminology/memory.md) — repo-wide 용어 SOT
- [worktree](../../runbook/worktree/memory.md) — multi-agent worktree 격리
