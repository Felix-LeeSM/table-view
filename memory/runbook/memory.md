---
title: Runbook
type: index
updated: 2026-07-31
keywords: 절차, runbook, 명령 시퀀스
---

# Runbook

"이 상황에서 이 명령 시퀀스 실행" — 절차 모음. 코드만 봐서는 재구성
불가능한 절차만 둔다. 코드 안에 이미 있는 것은 grep 으로 찾고, 본 방에
박지 마.

## 소유권 / SOT

- 본 방은 운영 절차의 의도, 순서, guardrail 만 소유한다.
- 위임할 스크립트는 없다. 각 런북 방이 절차의 유일한 SOT 이고, 명령은 표준
  git/gh/pnpm 으로 적는다.
- workflow 행동 계약은 [workflow](../workflow/memory.md) 가 소유하고, runbook 은
  실행 절차로만 연결한다.
- 미래 목표는 [docs/ROADMAP.md](../../docs/ROADMAP.md), historical 사건은
  [docs/archives/incidents](../../docs/archives/incidents/memory.md) 로 라우팅한다.

## 방 지도

- [worktree](./worktree/memory.md) — 다중 agent 병렬 작업의 독립 clone 사본 격리 룰 (생성·점유·회수)
- [pr-merge-gates](./pr-merge-gates/memory.md) — PR merge BLOCKED/UNSTABLE 진단 (review-gate + ruleset required context, 트리거 함정. `Runtime Happy Path` 는 실검사라 blocker 가 될 수 있다)

## 진입 규칙

- 본 방에 둘 것: 명령 시퀀스 + 환경 prereq + aggregation 의미론
- 본 방에 두지 말 것: 코드 marker 위치 (drift 위험 — grep 으로 찾을 것),
  단발 결과 데이터, 표준 `git`/`gh`/`pnpm --help` 와 중복되는 옵션 목록

## 관련

- [engineering/conventions](../engineering/conventions/memory.md) — 빌드 / 테스트 / 린트 명령 (단발 실행)
- [docs/archives/incidents](../../docs/archives/incidents/memory.md) — historical incident archive
