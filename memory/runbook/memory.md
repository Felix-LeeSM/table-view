---
title: Runbook
type: index
updated: 2026-07-31
keywords: 절차, runbook, 명령 시퀀스
---

# Runbook

"이 상황에서 이 명령 시퀀스 실행" — 절차 모음. 코드만 봐서는 재구성 불가능한
절차만 둔다. 코드 안에 이미 있는 것은 grep 으로 찾고, 본 방에 박지 마.

## 소유권 / SOT

- 본 방은 운영 절차의 의도, 순서, guardrail 만 소유한다.
- 위임할 스크립트는 없다. 명령은 표준 git/gh/pnpm 으로 적는다.
- workflow 행동 계약은 [workflow](../workflow/memory.md) 가 소유한다.
- 미래 목표는 [docs/ROADMAP.md](../../docs/ROADMAP.md), historical 사건은
  [docs/archives/incidents](../../docs/archives/incidents/memory.md) 로
  라우팅한다.

## 계약 / 절차 경계 — 다음 편집을 어디로 보내나

방이 cap 에 붙으면 긴 절차를 `.agents/skills/` 로 내리고 방에는 계약과 그 경로만
남긴다 (`AGENTS.md` 「강제 룰」). 그러면 한 주제가 두 파일에 걸치므로 다음
편집이 어디로 갈지 아래로 판정한다. 판정 질문은
**"그 문장을 안 읽으면 무엇이 깨지나"** 다.

- 읽는 즉시 **행동을 막거나 바꾸는** 문장 → 방. 금지 목록, 무엇이 SOT 인지,
  건드리면 안 되는 것, 누가 하는지, 어겼을 때 무엇이 고장 나는지.
- **명령을 어떤 순서로 치는지**와 그 순서를 고르게 하는 관찰 → skill. 무엇이 red
  면 무엇을 먼저 보나, 재시도 · 회복 · 청소 시퀀스.
- 한 사실이 양쪽에 필요하면 **방이 소유한다.** skill 은 결론만 쓰고 기전 · 수치
  · 이름 목록은 다시 적지 말고 방을 부른다. 두 벌이면 한쪽만 고쳐질 때
  tie-breaker("어긋나면 memory 가 이긴다")에 기대게 되는데, tie-breaker 는 이미
  어긋난 뒤에만 쓸모가 있어 어긋남 자체를 못 막는다.

이렇게 갈린 방은 `AGENTS.md` 매트릭스에서 **방과 skill 을 같이 주는 행**으로
찾는다 — 개수를 여기 적으면 다음 분리에서 낡는다.

## 방 지도

- [worktree](./worktree/memory.md) — 다중 agent 병렬 작업의 독립 clone 사본 격리
  룰 (생성·점유·회수)
- [pr-merge-gates](./pr-merge-gates/memory.md) — required context 목록과 게이트
  계약 (그 목록은 그 방의 `ci-gates` 블록 하나뿐이라 여기 열거하지 않는다).
  BLOCKED/UNSTABLE 진단 순서와 트리거 함정은
  [diagnosing-merge-gates](../../.agents/skills/diagnosing-merge-gates/SKILL.md)

## 진입 규칙

- 본 방에 둘 것: 명령 시퀀스 + 환경 prereq + aggregation 의미론. 단 skill 로
  갈린 방은 위 「계약 / 절차 경계」가 이 줄보다 우선한다 — 명령 시퀀스가 skill
  로 나가 있다.
- 본 방에 두지 말 것: 코드 marker 위치 (drift 위험 — grep 으로 찾을 것), 단발
  결과 데이터, 표준 `git`/`gh`/`pnpm --help` 와 중복되는 옵션 목록

## 관련

- [engineering/conventions](../engineering/conventions/memory.md) — 빌드 /
  테스트 / 린트 명령 (단발 실행)
- [docs/archives/incidents](../../docs/archives/incidents/memory.md) —
  historical incident archive
