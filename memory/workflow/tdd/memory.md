---
title: TDD Evidence
type: workflow-rule
updated: 2026-07-03
task: tdd, delivery, sprint
trigger:
  signal: code-profile sprint, RED commit
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# TDD Evidence

본 문서는 작업 방식을 마이크로매니징하지 않는다. 역할은 RED evidence 를 작업
초반에 보이게 하는 것.

## 강제하지 않는다 — 권고다 (2026-07-30 사용자 결정, #1987)

**실패하는 테스트를 먼저 커밋하는 것은 품질 수단이지 통과 조건이 아니다.**
먼저 커밋하지 않아도, 먼저 작성하지 않아도 문제가 되지 않는다.

**RED 를 강제하는 장치는 없다.** 이 방을 읽은 agent 가 스스로 판단한다.

## 권장 evidence

허용 subject 패턴:

- `[RED] ...`
- `RED: ...`
- `test: RED ...`
- `test ... failing`

RED commit 은 실패하는 테스트나 실패 expectation 을 작게 고정한다. 뒤 commit 이
GREEN 으로 통과시킨다.

## 작업자 재량

- 어떤 테스트 레벨(unit/integration/component)을 쓸지는 작업자가 정한다.
- 티켓은 작업 방식이 아니라 scope 와 수용 기준만 선언한다.

## Push 전 확인

```bash
base="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)"
git log "$base..HEAD" --format="%s"
```

위 범위에 RED subject 가 없다고 해서 push 를 미루지는 않는다 — 권고이지 조건이
아니다.

## 예외

- 긴급 hotfix 에서 RED 를 건너뛰면 이후 follow-up 에서 검증 근거를 남긴다.

## 관련

- [delivery](../delivery/memory.md) — push/PR/merge pipeline
- [review](../review/memory.md) — PR review 행동 계약
- [git-policy](../git-policy/memory.md) — 검증 우회 금지
