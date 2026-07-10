---
title: Runbook
type: index
updated: 2026-06-12
---

# Runbook

"이 상황에서 이 명령 시퀀스 실행" — 절차 모음. 코드만 봐서는 재구성
불가능한 절차만 둔다. 코드 안에 이미 있는 것은 grep 으로 찾고, 본 방에
박지 마.

## 소유권 / SOT

- 본 방은 운영 절차의 의도, 순서, guardrail 만 소유한다.
- 정확한 CLI 옵션 / side effect / 구현 상세는 각 `scripts/**` 파일과 `--help` 가
  소유한다.
- workflow 행동 계약은 [workflow](../workflow/memory.md) 가 소유하고, runbook 은
  실행 절차로만 연결한다.
- 미래 목표는 [docs/ROADMAP.md](../../docs/ROADMAP.md), historical 사건은
  [docs/archives/incidents](../../docs/archives/incidents/memory.md) 로 라우팅한다.

## 방 지도

- [worktree](./worktree/memory.md) — 다중 agent / brain 병렬 작업용 git worktree 사용 룰
- [pr-merge-gates](./pr-merge-gates/memory.md) — PR merge BLOCKED/UNSTABLE 진단 (review-gate + E2E ruleset 이중 게이트, 트리거 함정)

## 진입 규칙

- 본 방에 둘 것: 명령 시퀀스 + 환경 prereq + aggregation 의미론
- 본 방에 두지 말 것: 코드 marker 위치 (drift 위험 — grep 으로 찾을 것),
  단발 결과 데이터 (sprint doc 가 source), script help 와 중복되는 옵션 목록

## 관련

- [engineering/conventions](../engineering/conventions/memory.md) — 빌드 / 테스트 / 린트 명령 (단발 실행)
- [docs/archives/incidents](../../docs/archives/incidents/memory.md) — historical incident archive
