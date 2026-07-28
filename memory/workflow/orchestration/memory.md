---
title: Orchestration — 병렬 작업 spawn · 리뷰 큐 · 사이클 정지
type: workflow-rule
updated: 2026-07-27
task: orchestration, parallel-pr, spawn, review-queue, cycle-detection, issue-authoring
trigger:
  signal: 여러 작업을 동시에 돌리거나, 이슈를 발행하거나, 리뷰 라운드가 안 끝날 때
  layer: agent-prompt (top-level orchestrator)
---

# Orchestration

Top-level orchestrator 의 행동 계약. 개별 작업 방법은 각 skill 이 SOT 이고, 이
방은 **작업 사이의 결정** 만 둔다 — 무엇을 언제 spawn 하는가, 리뷰를 어떤 순서로
붙이는가, 언제 멈추는가.

## 1. 범위를 예측하지 않는다

파일 범위를 가장 잘 아는 쪽이 가장 늦게 알고, 가장 일찍 결정해야 하는 쪽이 가장
모른다 — orchestrator 는 primary worktree 가 orchestration-only 라 코드를 읽지
않고 checkout 도 밀려 있다. 구현 agent 는 착수해봐야 안다.

그래서 spawn 시점에 겹침을 예측해 막지 않는다. **PR 생성 직후 사실로 대조한다.**

    gh pr view <N> --json files -q '.files[].path'

**Why**: 2026-07-25 동시 in-flight 8건에서 28쌍 중 18쌍이 파일 교집합을 가졌고,
`docs/contributor-guide/testing-and-quality.md` 하나를 5개 PR 이 동시 수정했다
(`docs/ROADMAP.md` 4개, `docs/product/known-limitations.md` 3개). 예측 기반
설계였다면 셋 다 놓쳤다.

## 2. 작업은 병렬로, 리뷰를 직렬화한다

충돌 비용은 작업이 아니라 리뷰다. 겹침이 있으면 작업을 막는 게 아니라 **리뷰 큐
순서** 를 준다.

- 교집합이 있는 PR 은 큐 뒤로. 앞 PR merge 후 `git merge` 로 최신 base 를 들인 뒤
  리뷰한다 (rebase 는 force-push 가 필요해 금지 — [git-policy](../git-policy/memory.md)).
- 큐 순서는 충돌 표면이 작은 것부터.
- 뒤 PR 은 항상 최신 base 에서 리뷰되므로 충돌 finding 이 구조적으로 안 생긴다.

## 3. 사이클이면 멈추고 사용자에게 올린다

트리거는 `.agents/skills/pr-review/SKILL.md` Verdict 원칙 3 위반이다 — 라운드 k+1 의 blocking
집합이 라운드 k 의 진부분집합이 아니다.

1. 해당 PR 리뷰 중단.
2. 파일 교집합이 있는 in-flight PR 을 리뷰 큐에서 함께 정지 (작업은 그대로).
3. 사용자에게 보고하고 대기한다. **orchestrator 는 여기서 판단하지 않는다.**

보고에 담을 것: 라운드별 blocking 집합 변화 / 재발한 유형과 라운드별 건수 /
저자가 시도한 것 / 함께 정지된 PR 과 공유 파일 / 선택지(범위 축소·근본
분리·닫고 재설계).

**Why**: 사이클 지점은 정의상 자동 판단이 이미 실패한 곳이다. 저자가 잡은 근본이
다음 라운드에 재발 판정을 받은 실제 사례가 있으므로, orchestrator 가 "무엇이
근본인가" 를 자동 판정하면 같은 실패를 조용히 반복한다.

## 4. 이슈는 확대해석의 여지가 없어야 한다

이슈 본문의 배경·근본원인·표는 상세해도 좋다. **닫혀야 하는 것은 수용 기준이다.**

- 완료 조건은 **명령 출력 하나**다. 여러 개면 이슈를 나눈다.
- **적히지 않은 것은 범위 밖이다.** 구현자도 리뷰어도 넓힐 수 없다.
- "~별로 판정" 같은 재량 항목은 판정 기준을 이슈에 박거나, 그 판단 자체를 별도
  조사 이슈로 뺀다.
- 유형 단위로 연다. 한 유형에 10건이 걸려도 이슈는 10개가 아니라 1개다.

전수 명령의 hit 수가 곧 작업 크기다 — 예측 없이 착수 전에 알 수 있다.

**Why**: 상세함과 닫힘은 다르다. 수용 기준 5개가 전부 "전 target 열거 / 전수 조사
/ target 별로 판정" 이던 이슈가 낳은 PR 은 5라운드 끝에 닫혔다. 열린 집합 주장은
반증만 되고 검증은 안 된다 — 종료 조건이 없다.

## 5. 이슈 1개 ≠ PR 1개

착수 시점에 변경 기준을 잡고 작업을 자른다. 이슈가 크면 PR 을 나눈다 — 리뷰가
쪼개라고 말하는 건 이미 라운드를 태운 뒤라 늦다.

## 6. 상충

- **파일 충돌** — §1·§2 로 처리. 연속 번호 배치 이슈는 실행 순서를 이슈에 명시한다.
- **결정 상충** — 파일이 안 겹쳐도 발생하고 구현 후에야 드러난다. 사후 탐지에
  맡긴다(§3 트리거). 열린 이슈 전부를 ADR 로 승격시키는 건 현재 자원 밖이다.

## 관련

- `.agents/skills/pr-review/SKILL.md` — Verdict 원칙 1·2·3 정의. 사이클 트리거의 source
- [review](../review/memory.md) — reviewer 행동 계약
- [delivery](../delivery/memory.md) — 구현 완료 후 T0~T7 파이프라인
- [git-policy](../git-policy/memory.md) — force-push 금지, rebase 대신 merge
- [worktree](../../runbook/worktree/memory.md) — linked worktree spawn
- [pr-merge-gates](../../runbook/pr-merge-gates/memory.md) — merge 게이트 진단
