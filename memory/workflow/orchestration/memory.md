---
title: Orchestration — 병렬 작업 spawn · 리뷰 큐 · 사이클 정지
type: workflow-rule
updated: 2026-07-31
task: orchestration, parallel-pr, spawn, review-queue, cycle-detection, issue-authoring
keywords: spawn, slot, 병렬, 파일 교집합, 리뷰 큐, 수용 기준, 접수 조건, 사이클, needs:user, 이슈 발행, 유형 단위, raw, task
trigger:
  signal: 여러 작업을 동시에 돌리거나, 이슈를 발행하거나, 리뷰 라운드가 안 끝날 때
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# Orchestration

Orchestrator 의 행동 계약 — interface 가 `.agents/prompts/orchestrator.md`
파일 그대로 spawn 하는 subagent 다. 개별 작업 방법의 SOT 는 없고, 이
방은 **작업 사이의 결정** 만 둔다 — 무엇을 언제 spawn 하는가, 리뷰를 어떤 순서로
붙이는가, 언제 멈추는가.

**입력은 task 티켓과 label 뿐이다.** 사용자 산문은 접수하지 않는다 — 설계·범위
발화가 오면 [interface](../interface/memory.md) 가 티켓으로 만들어야 한다.

## 1. 파일 범위는 착수 전에 티켓이 갖는다

티켓을 쓰는 쪽이 착수 전에 전수 명령을 **실제로 돌려서** 티켓에 파일 범위를
박는다. 그 출력이 곧 범위다 — 범위를 예측으로 채우지 않는다.

그래서 spawn 전에 티켓의 파일 범위로 겹침을 재고, PR 이 열린 뒤에는 사실로 다시
대조한다.

    gh pr view <N> --json files -q '.files[].path'

필요한 것은 **겹치는 쌍과 순서**뿐이고 파일 목록 자체는 아니다. 목록을 걸러서
돌려주던 script 는 없어졌고 대체물도 없다 (§2).

**Why**: 2026-07-25 동시 in-flight 8건에서 28쌍 중 18쌍이 파일 교집합을 가졌고,
`docs/contributor-guide/testing-and-quality.md` 하나를 5개 PR 이 동시 수정했다
(`docs/ROADMAP.md` 4개, `docs/product/known-limitations.md` 3개). 겹침은 예외가
아니라 기본값이라 재지 않으면 리뷰 한 라운드가 통째로 버려진다.

## 2. 작업은 병렬로, 리뷰를 직렬화한다

충돌 비용은 작업이 아니라 리뷰다. 겹침이 있으면 작업을 막는 게 아니라 **리뷰 큐
순서** 를 준다. 판단이 0 인 계산이라 원래 script 가 맡던 자리인데, 지금은 그
script 도 대체물도 없다.

- 교집합이 있는 PR 은 큐 뒤로. 앞 PR merge 후 `git merge` 로 최신 base 를 들인 뒤
  리뷰한다 (rebase 는 force-push 가 필요해 금지 — [git-policy](../git-policy/memory.md)).
- 큐 순서는 충돌 표면이 작은 것부터.
- 뒤 PR 은 항상 최신 base 에서 리뷰되므로 충돌 finding 이 구조적으로 안 생긴다.

## 3. 사이클이면 멈추고 사용자에게 올린다

판정 주체는 회고 모드 리뷰어다 — 라운드 3부터는 개별 지적이 아니라 같은
유형의 반복을 본다. 저자도 orchestrator 도 여기서 판정하지 않는다.
트리거는 라운드 k+1 의 blocking 집합이 라운드 k 의 진부분집합이 아닐 때다.

1. 해당 PR 리뷰 중단.
2. 파일 교집합이 있는 in-flight PR 을 리뷰 큐에서 함께 정지 (작업은 그대로).
3. [interface](../interface/memory.md) 를 거쳐 사용자에게 올리고
   대기한다(`needs:user`). **orchestrator 는 판단하지 않는다.**

보고에 담을 것: 라운드별 blocking 집합 변화 / 재발한 유형과 라운드별 건수 /
저자가 시도한 것 / 함께 정지된 PR 과 공유 파일 / 선택지(범위 축소·근본
분리·닫고 재설계).

**Why**: 사이클 지점은 정의상 자동 판단이 이미 실패한 곳이다. 저자가 잡은 근본이
다음 라운드에 재발 판정을 받은 실제 사례가 있으므로, 저자나 orchestrator 가 "무엇이
근본인가" 를 자동 판정하면 같은 실패를 조용히 반복한다.

## 4. 이슈는 확대해석의 여지가 없어야 한다

티켓을 쓰는 주체가 이 절을 기준으로 삼는다. 이슈 본문의
배경·근본원인·표는 상세해도 좋다. **닫혀야 하는 것은 수용 기준이다.**

- 완료 조건은 **명령 출력 하나**다. 여러 개면 이슈를 나눈다.
- **적히지 않은 것은 범위 밖이다.** 구현자도 리뷰어도 넓힐 수 없다.
- "~별로 판정" 같은 재량 항목은 판정 기준을 이슈에 박거나, 그 판단 자체를 별도
  조사 이슈로 뺀다.
- 유형 단위로 연다. 한 유형에 10건이 걸려도 이슈는 10개가 아니라 1개다.

전수 명령의 hit 수가 곧 작업 크기다 — 예측 없이 착수 전에 알 수 있다.

**이 절은 orchestrator 의 접수 조건이다.** 못 채운 이슈는 `task` 가 아니라
`raw` 다. raw → task 승격은 [interface](../interface/memory.md) 전담 — 어떤
노드도 `task` 를 직접 발행하지 않는다.

**Why**: 상세함과 닫힘은 다르다. 수용 기준 5개가 전부 "전 target 열거 / 전수 조사
/ target 별로 판정" 이던 이슈가 낳은 PR 은 5라운드 끝에 닫혔다. 열린 집합 주장은
반증만 되고 검증은 안 된다 — 종료 조건이 없다.

## 5. 이슈 1개 ≠ PR 1개

명세 작성자가 착수 시점에 변경 기준을 잡고 작업을 자른다. 이슈가 크면 PR 을
나눈다 — 리뷰가 쪼개라고 말하는 건 이미 라운드를 태운 뒤라 늦다.

## 6. 상충

- **파일 충돌** — §1·§2 로 처리. 연속 번호 배치 이슈는 실행 순서를 이슈에 명시한다.
- **결정 상충** — 파일이 안 겹쳐도 발생하고 구현 후에야 드러난다. 사후 탐지에
  맡긴다(§3 트리거). 열린 이슈 전부를 ADR 로 승격시키는 건 현재 자원 밖이다.

## 7. 도달은 spawn 하는 쪽이 책임진다

노드가 memory 를 스스로 읽으러 오리라 기대하지 않는다 — 안 읽는 것이 실측이다.
그래서 고정부를 파일로 두고 **spawn 하는 쪽이 그대로 첨부**한다: 역할 preamble
`.agents/prompts/<role>.md` (Claude Code 네이티브 spawn 은 `.claude/agents/<role>.md`
정의가 그 파일을 첫 행동으로 읽는다). preamble 은 MANDATORY 첫 명령(사본 경로
검증)과 착수 전 MANDATORY read 목록을 싣고, **계약 본문은 복제하지 않는다** —
읽는 것이 노드의 첫 행동이다. spawn 메시지는 가변부만 싣는다. 형식은
`.agents/prompts/orchestrator.md` 의 "Spawn 규칙".

## 관련

- [interface](../interface/memory.md) — 사용자 대화·티켓 승격·orchestrator 운용
- [review](../review/memory.md) — reviewer 행동 계약
- [delivery](../delivery/memory.md) — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 계약
- [git-policy](../git-policy/memory.md) — force-push 금지, rebase 대신 merge
- [worktree](../../runbook/worktree/memory.md) — 작업 사본(clone) 생성·점유·회수
- [pr-merge-gates](../../runbook/pr-merge-gates/memory.md) — merge 게이트 진단
