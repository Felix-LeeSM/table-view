---
title: Harness run ledger
type: workflow-rule
updated: 2026-05-26
task: harness, sprint, read-verified, run-ledger
trigger:
  signal: /harness run 생성 또는 sprint evidence 갱신
  layer: agent-prompt
---

# Harness run ledger

첫 개선 단위는 **run ledger** 이다. contract/prompt/script 를 먼저 고치지 않고,
harness 실행 상태를 남기는 artifact 부터 설계한다.

Run ledger canonical artifact 는 `docs/sprints/sprint-N/run.md` 이다. Markdown 을
우선 source 로 둔다. 초기 단계에서는 사람/agent 가 함께 읽고 review 하기 쉬운
형태가 script 파싱 편의보다 중요하다.

## Status 표현

- Phase 진행은 checkbox 로 표시한다.
- AC 상태는 evidence table 로 표시한다.
- Checkbox 만으로 완료 주장 금지. `[x]` 는 같은 section 또는 table 에 evidence
  link/summary 를 가져야 한다.
- Partial/fail/blocked 는 checkbox 대신 table status
  (`todo|running|pass|fail|blocked`) 로 표현한다.

## 최소 gate

초기 `run.md` 는 최소 ledger 로 시작한다:

- `State`: phase checkbox.
- `Read Evidence`: role 별 읽은 SOT 와 적용 요약.
- `AC Evidence`: AC 별 status/evidence.
- `Checks`: verification/check 결과.
- `Blockers`: open blocker 와 next action.

2026-05-26 grill lock: 첫 hard gate 는 sprint 별 `run.md` 존재, `Read Evidence`,
`AC Evidence`, `Checks` table 만 필수다. Phase owner/attempt/worktree/timestamp
state machine 은 2차 확장이다.

`Read Evidence` 는 terminology 영향 여부를 포함한다. Naming/UI copy/docs/tests
또는 agent gate term 을 건드리는 작업은 [terminology](../../../terminology/memory.md)
읽음 + 적용/비영향 요약을 남긴다.

## Context budget

`run.md` 는 agent context dump 가 아니라 side-channel artifact 다. phase agent 에게
전체 `run.md` 를 넘기지 않고, 해당 phase 에 필요한 행/요약만 전달한다.

Evidence 셀은 긴 로그를 붙이지 않고 한 줄 summary + 파일/명령 link 로 남긴다.
장문 stdout, hook log, test output 은 별도 파일 또는 command reference 로 두고
Reviewer 가 필요할 때 pull 한다.

## Pass update

Orchestrator 는 phase agent 자기보고만으로 `pass` 를 쓰지 않는다. `pass` 는 파일
diff, 테스트/빌드/린트 명령 결과, browser/API/static inspection, Reviewer finding
중 하나의 실제 evidence 가 있을 때만 쓴다. 근거가 애매하면 `running|fail|blocked`
와 next action 으로 남긴다.

## AC evidence granularity

`run.md` 의 `AC Evidence` 는 AC 1개당 row 1개로 유지한다.
Scenario/happy/error/edge 세부 row 를 만들지 않는다. 세부 시나리오는
`contract.md`, test file, findings 에 두고 `run.md` 는 `AC-01 | status | 한 줄
evidence` 로 요약한다.

## Lifecycle

생성 시점: Planning 시작 직후. Planner 가 spec 을 쓰기 전에
`docs/sprints/sprint-N/run.md` 를 만든다. 이후 모든 phase 가 같은 ledger 를
갱신한다.

갱신 책임: orchestrator 가 `run.md` 를 갱신한다. phase agent 는 evidence 후보와
상태 보고를 출력하고, orchestrator 가 ledger 에 반영한다. agent 가 자기 phase 의
checkbox 를 직접 완료 처리하지 않는다.

전체 state machine(phase attempt/owner/worktree/timestamp 상세)은 2차 확장이다.
`contract.md` 에 실행 로그를 섞지 않는다.

## Start protocol

`/harness <task>` 시작 시 orchestrator 는 먼저 아래를 수행한다:

1. sprint 번호를 결정한다. 번호가 없으면 `docs/sprints/` 다음 미사용 정수.
2. `docs/sprints/sprint-N/run.md` 를 생성한다.
3. Thin Read Pack 후보를 만든다.
4. `Research Scout` 조건부 spawn 필요성을 판단한다.
5. `Planner-Contract` 에게 Thin Read Pack 과 사용자 task 를 전달한다.

## 관련

- [harness](../memory.md) — index
- [principles](../principles/memory.md) — read-verified 원칙
- [agents](../agents/memory.md) — phase worker 책임
