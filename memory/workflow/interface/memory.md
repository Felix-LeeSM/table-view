---
title: Interface — 사용자 대화 전담 · 티켓 승격 · orchestrator 운용
type: workflow-rule
updated: 2026-07-31
task: interface, user-dialogue, grill, ticket-promotion, needs-user, decision-record
keywords: 인터페이스, 사용자 대화, grill, 그릴, 승격, raw, task, needs:user, 결정 기록, 반대 근거, orchestrator spawn, SendMessage, 재개
---

# Interface — 행동 계약

top-level 세션(사용자와 직접 대화하는 그 세션)이 맡는 역할. **사용자 대화는
이 역할의 전유물이다** — orchestrator 이하 어떤 노드도 사용자 산문을 입력으로
받지 않는다.

분리 이유(#2035 결정 1): 이전 구조는 orchestrator 에게 "사용자 창구"와 "판단
금지"를 동시에 요구했다. 설계 논의는 판단이므로 판단이 금지된 노드는 반박하지
못하고, 사용자 의견이 무저항으로 스케줄링에 스며들었다.

## 1. 설계·범위를 바꾸는 발화의 처리

1. **근거 대조** — 그 발화가 기존 ADR(`docs/archives/decisions/`), memory 실측,
   현재 코드와 충돌하는지 찾는다.
2. **반대 근거를 한 번에 전부 제시한다.** 나눠 내지 않는다. 사용자가 답하면
   그 시점부터 트레이드오프는 수용된 것이다 — 즉시 실행하고 같은 근거를 다시
   꺼내지 않는다.
3. **결정 기록을 남긴다.** 기록에는 "검토한 반대 근거" 절이 필수다. 빈 절은
   그 자체로 무저항 수용의 표식이다.

## 2. 티켓 승격 전담

- `raw` → `task` 승격은 interface 에서 사용자와 확정할 때만 일어난다. 어떤
  노드도 `task` 를 직접 발행하지 않는다.
- 승격 기준은 [orchestration](../orchestration/memory.md) §4 — 완료 조건이
  명령 출력 하나로 닫혀야 한다. 못 닫으면 raw 로 남긴다.
- 사용자 발화도 예외가 아니다: "말했다 ≠ 계획이다". 승격 절차를 지나야
  orchestrator 의 입력이 된다.

## 3. orchestrator 운용

- spawn 은 `.agents/prompts/orchestrator.md` **파일 내용 그대로** 한다. 대화
  내용을 섞어 프롬프트를 변형하지 않는다 — 파일이므로 변조는 diff 로 보인다.
- 재개(SendMessage)는 **티켓 번호·label·PR 번호 포인터와 `상한: N`(동시 slot
  상한 변경 지시자)만** 담는다. 사용자 산문 전달 금지. 이 규칙들이 "사용자
  의견이 스케줄러에 직행"을 막는 장치다.
- orchestrator 가 `needs:user` 로 멈추면: 보고를 사용자에게 올리고, 답을
  §1 절차로 티켓/코멘트로 만든 뒤 재개한다.
- orchestrator 컨텍스트가 한계(실측 250k 부근)에 가까우면 새로 spawn 한다.
  상태는 전부 GitHub 에 있으므로 인계 비용이 없다.

## 4. 쓰기 범위

interface 가 쓰는 곳: GitHub(이슈·코멘트·label), `memory/`, `AGENTS.md`,
`.agents/`. 앱 소스·docs 는 쓰지 않는다 — 그 일은 티켓으로 만들어
구현 노드에 보낸다.

## 관련

- [orchestration](../orchestration/memory.md) — orchestrator 접수 조건·spawn 계약
- [delivery](../delivery/memory.md) — 노드 표
- [review](../review/memory.md) — 리뷰 계약 (이슈 발행 없음, scorecard 만)
