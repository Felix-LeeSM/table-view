---
title: Harness principles
type: workflow-rule
updated: 2026-05-26
task: harness, workflow-sot, read-verified
trigger:
  signal: 사용자가 /harness 요청 또는 agentic workflow 개선 논의
  layer: agent-prompt
---

# Harness principles

Harness 는 agent 를 활용해 작은 PR 단위 작업을 만들고, 최종 승인을 사람의 PR
merge 로 받기 위한 workflow 이다. Agent 는 build → evaluate → improve 루프를
돌려 사람이 review 할 최선의 PR 과 handoff 를 준비한다.

## Source boundary

`docs/archives/audits/harness-issues-handoff-2026-05-25.md` 는 raw audit input 이다. 문제의식만 가져오고
해결책은 본 workflow 에서 별도 설계한다. audit 문장을 그대로 rule 로 승격하지
않는다.

Harness skill/prompts/templates 는 thin wrapper/runner 로 유지한다. 정책, 결정,
예외, workflow topology 의 source of truth 는 `memory/workflow/harness/` 다. Skill
파일에 핵심 룰을 복사해 중복 SOT 를 만들지 않는다. Skill 은 필요한 memory
section/path 와 실행 순서만 가리킨다.

모든 SOT 는 repo 안 tracked file 이어야 한다. 외부 채팅, tool memory, GitHub issue,
PR comment 는 repo 의 memory/docs/ADR 로 반영되기 전까지 SOT 가 아니다.

Prompt 는 ultra-thin 이 아니라 operational-thin 으로 둔다. 역할별
input/output/process/금지만 담아 agent 가 실행 가능하게 하되, 정책 이유, 긴 rubric,
예외 결정은 memory 로 둔다. Template 은 산출물 shape 만 담고 정책을 품지 않는다.

## Human review boundary

Harness 는 human-in-the-loop workflow 다. Generator/Builder 와 Reviewer/Evaluator 는
유지하지만, 이들은 human review 를 대체하지 않는다. Agent 는 prepare / inspect /
recommend 까지만 한다. certify / approve / merge / scope 재정의는 사용자 명시
review/승인이 필요하다.

최종 승인 gate 는 PR merge 다. 어느 정도의 불확실성은 PR size 를 작게 유지하는
것으로 감수한다. Scope/architecture 가 불확실해도 destructive action 이 아니고 PR 이
작고 review 가능하면 agent 는 build/evaluate/improve 를 진행할 수 있다.

`user-review-ready` 는 사람이 읽을 수 있는 handoff 가 준비됐다는 뜻이다. Handoff 는
내부 로그가 아니라 사용자 review packet 이어야 하며, 변경 내용, AC evidence, checks,
review findings, 남은 risk, 사용자가 결정해야 할 항목을 짧게 보여준다.

Destructive action 은 정성 판단으로만 막지 않는다. 원칙은 hook/blocking script 로
기계 차단하고, prompt/skill 에도 같은 금지를 적어 우회 시도를 줄인다.

Human-facing progress SOT 는 [roadmap](../../roadmap/memory.md) 이다. Agent 는 PR 로
작업을 끝내되, sequencing/status 변경이 있으면 PLAN/ROADMAP 계열 SOT 갱신 여부를
handoff 와 PR body 에 명시한다.

## Audit priority lock

2026-05-26 grill lock: audit 의 우선순위(#8 용어 정렬 first)와 본 SOT 의
`run ledger first` 가 충돌할 때는 본 SOT 를 유지한다. 이유는 용어/원칙을 먼저
써도 read evidence 가 없으면 다시 write-only 가 되기 때문이다. 용어 정렬은 run
ledger 가 읽힘/적용 증거를 담을 수 있게 된 뒤 foundation track 으로 다룬다.

2026-05-26 update: user review gate 로 agent 권한을 더 낮췄다. terminology 는
workflow 하위가 아니라 repo-wide foundation 이므로
[terminology](../../../terminology/memory.md) 를 따른다. `Reviewer`, `user review`,
`approval`, `user-review-ready`, `evidence`, `AC` 같은 단어가 섞이면 gate 가
무력화된다.

## 닫아야 할 루프

- 읽어야 할 SOT 를 실제로 읽었는가.
- acceptance criteria 가 테스트/증거와 연결됐는가.
- 이전 sprint invariant 가 다음 sprint 에서 보호됐는가.
- 생성된 handoff/memory/docs 가 다음 작업에서 다시 읽히는가.
- hook/review/CI 결과가 agent context 를 오염시키지 않고 평가에 쓰이는가.

## 설계 원칙

1. **Read evidence beats trust**: 읽은 SOT 와 적용 rule 을 artifact 에 남긴다.
2. **AC maps to evidence**: 모든 AC 는 test/check/file/browser evidence 중 하나에
   연결된다. 연결 없는 AC 는 완료 아님.
3. **State is explicit**: phase, attempt, owner, worktree, verification status 는
   artifact/script 로 확인 가능해야 한다.
4. **Reviewer pulls signal**: hook/CI/log 는 agent 에게 push 하지 않고,
   Reviewer 가 필요한 signal 만 pull 한다.
5. **Workflow first, automation second**: hard gate 는 workflow 의미가 잠긴 뒤
   붙인다. script 가 SOT 를 대신하지 않는다.

## 관련

- [harness](../memory.md) — index
- [run-ledger](../run-ledger/memory.md) — 첫 개선 단위
- [agents](../agents/memory.md) — worker topology
