---
title: Interface — 사용자 대화 전담 · 티켓 승격 · orchestrator 운용
type: workflow-rule
updated: 2026-08-14
task: interface, user-dialogue, grill, ticket-promotion, needs-user, decision-record, issue-authoring
keywords: 인터페이스, 사용자 대화, grill, 그릴, 승격, raw, task, needs:user, 결정 기록, 반대 근거, orchestrator spawn, SendMessage, 재개, 겸무, 직접 orchestration, 겸무 SOT, MANDATORY read, non-blocking, scorecard, 이슈화, 이슈 발행, 머지 보고, orchestrator 교체, 인계, 대기 칸, 대기 칸 행선지, mergedAt
---

# Interface — 행동 계약

top-level 세션(사용자와 직접 대화하는 그 세션)이 맡는 역할. **사용자 대화는
이 역할의 전유물이다** — orchestrator 이하 어떤 노드도 사용자 산문을 입력으로
받지 않는다.

분리 이유(#2035 결정 1): 이전 구조는 orchestrator 에게 "사용자 창구"와 "판단
금지"를 동시에 요구했다. 설계 논의는 판단이므로 판단이 금지된 노드는 반박하지
못하고, 사용자 의견이 무저항으로 스케줄링에 스며들었다.

## 1. 설계·범위를 바꾸는 발화의 처리

1. **근거 대조** — 그 발화가 기존 ADR(`docs/decisions/`), memory 실측,
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
- **scorecard 의 non-blocking 을 이슈로 올리는 것은 interface 이고, 시점은 머지 보고를 받은 턴이다.**
  종결자를 직접 띄운 겸무 턴에는 그 반환(`.agents/prompts/pr-finalize.md` 「반환 형식」)에
  머지된 PR 번호가 실려 이 세션에 닿는다. 그 턴에 아래로 그 PR 의 scorecard 를 읽고, 같은
  유형의 열린 이슈가 있으면 코멘트로 붙이고 없으면 새로 연다 — 유형으로 묶는 기준은
  [orchestration](../orchestration/memory.md) §4 다.
  리뷰어와 종결자는 이슈를 못 열어서, 이 턴을 놓치면 그 non-blocking 은 아무 데도 안 간다.
  **§3 으로 orchestrator 에 위임한 세션에는 그 반환이 orchestrator 에서 멈춘다** — 대신
  `.agents/prompts/orchestrator.md` 「보고 형식」의 머지 칸이 번호와 머지 SHA 를 올려 같은
  턴을 연다. 그 칸의 계약은 [orchestration](../orchestration/memory.md) §7 이다.

  ```bash
  gh pr view <N> --repo Felix-LeeSM/table-view --json comments -q '.comments[].body'
  ```

## 3. orchestrator 운용

- **interface 가 orchestration(스폰·리뷰 큐·머지)을 직접 겸무해도 된다** —
  2026-07-31 사용자 수용. 노드를 갈아 끼울 때 생기는 통지 반응 지연이 실비용이다.
  분리가 막던 위험은 겸무해도 규율로 유지한다: spawn 프롬프트 자기완결(대화 내용
  혼입 금지), 리뷰어 독립(저자 아닌 쪽이 부착), 사용자 제안에 반대 근거 의무(§1).
  루틴을 위임할 때는 아래 규칙 그대로 orchestrator 를 띄운다. **이 절이 겸무
  결정의 SOT 다** — 다른 방과 고정부는 여기를 가리키고 조건을 옮겨 적지 않는다.
- **겸무하는 턴에는 [orchestration](../orchestration/memory.md) 전문을 연다 —
  MANDATORY.** spawn 된 orchestrator 는 그 계약을
  `.agents/prompts/orchestrator.md` 첨부로 받지만 겸무 세션은 그 첨부도
  `.claude/agents/<role>.md` 정의도 안 받는다. 그 방을 안 열면 §2 동시 slot 상한과
  리뷰 큐 직렬화 · §3 사이클 정지 · §7 고정부 첨부 rev · §8 정지 조건을 모르는
  채로 스케줄링한다 — 2026-08-10~11 겸무 세션이 그 방을 규율이 아니라 우연으로
  열었다. **열거 항목에는 § 를 붙여 대조 가능하게 둔다** — 주소 없이 이름만 적힌
  항목은 대상이 그 방에서 사라져도 아무도 못 잡는다.
- spawn 은 `.agents/prompts/orchestrator.md` **파일 내용 그대로** 한다. 대화
  내용을 섞어 프롬프트를 변형하지 않는다 — 파일이므로 변조는 diff 로 보인다.
- 재개(SendMessage)는 **티켓 번호·label·PR 번호 포인터와 `상한: N`(동시 slot
  상한 변경 지시자)만** 담는다. 사용자 산문 전달 금지. 이 규칙들이 "사용자
  의견이 스케줄러에 직행"을 막는 장치다.
- orchestrator 가 `needs:user` 로 멈추면: 보고를 사용자에게 올리고, 답을
  §1 절차로 티켓/코멘트로 만든 뒤 재개한다.
- orchestrator 컨텍스트가 한계(실측 250k 부근)에 가까우면 새로 spawn 한다.
  **교체 전에 마지막 pass 보고의 머지 칸과 `대기` 칸을 이어받는다** — 머지 칸은 이 세션이
  §2 로 처리한다. **`대기` 칸도 머지된 PR 은 머지 칸과 같이 이 세션이 §2 로 처리하고**,
  나머지만 위 재개 규칙의 PR 번호 포인터로 새 orchestrator 에 넘긴다. 가르는 조회는 번호마다
  `gh pr view <N> --repo Felix-LeeSM/table-view --json mergedAt` 다 — 종결자 반환 전에 끝난
  pass 의 PR 이 `대기` 로 오므로([orchestration](../orchestration/memory.md) §7) 인계 시점에
  이미 머지된 PR 이 거기 있다.
  **그 조회는 §7 이 막는 `gh pr list --state merged` 가 아니다** — 금지 사유인 창이 없다.
  집합은 마지막 pass 보고의 `대기` 칸으로 닫히고 교체 때 한 번만 넘어온다.
  머지된 PR 은 새 노드의 상태 수집(`--state open`)에서 빠지고, 그 번호가 돌아오는 자리는
  이 인계다. 나머지 상태는 GitHub 에 있어 새 노드가 스스로 모은다.

## 4. 쓰기 범위

interface 가 쓰는 곳: GitHub(이슈·코멘트·label), `memory/`, `AGENTS.md`,
`.agents/`. 앱 소스·docs 는 쓰지 않는다 — 그 일은 티켓으로 만들어
구현 노드에 보낸다.

## 관련

- [orchestration](../orchestration/memory.md) — orchestrator 접수 조건·spawn 계약
- [delivery](../delivery/memory.md) — 노드 표
- [review](../review/memory.md) — 리뷰 계약 (이슈 발행 없음, scorecard 만)
