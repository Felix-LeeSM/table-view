---
title: TDD evidence for code-profile sprints
type: workflow-rule
updated: 2026-05-23
task: tdd, delivery, pre-push, sprint
trigger:
  signal: code-profile sprint, RED commit, TDD-cycle hook
  layer: agent-prompt + pre-push
---

# TDD Evidence

본 문서는 작업 방식을 마이크로매니징하지 않는다. 역할은 `review-profile: code`
sprint 의 delivery gate 가 요구하는 evidence 를 작업 초반에 보이게 하는 것.

## 적용 조건

- branch 이름이 `sprint-N/...`
- `docs/sprints/sprint-N/contract.md` frontmatter 가 `review-profile: code`
- pre-push `scripts/hooks/check-tdd-cycle.sh` 가 `merge-base..HEAD` 에 RED commit
  subject 를 요구

## 요구 evidence

code-profile sprint 는 push 전에 RED commit 이 있어야 한다.

허용 subject 패턴:

- `[RED] ...`
- `RED: ...`
- `test: RED ...`
- `test ... failing`

RED commit 은 실패하는 테스트나 실패 expectation 을 작게 고정한다. 뒤 commit 이
GREEN 으로 통과시킨다.

## 작업자 재량

- 어떤 테스트 레벨(unit/integration/component)을 쓸지는 작업자가 정한다.
- sprint contract 는 작업 방식이 아니라 scope/profile 만 선언한다.
- sprint-build 는 TDD 를 강제 적용하지 않는다. delivery gate evidence 를
  사전에 확인할 뿐이다.

## Push 전 확인

```bash
base="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)"
git log "$base..HEAD" --format="%s"
```

위 범위에 RED subject 가 없으면 push 전에 commit history 를 고친다. hook 실패
후 `SKIP_TDD_CYCLE=1` 같은 skip env 는 사용자 명시 승인 없이는 금지.

## 예외

- `review-profile` 이 `docs`, `infra`, `security` 등 code 가 아니면 적용하지 않는다.
- 긴급 hotfix 에서 skip 이 필요하면 사용자가 명시해야 한다. 이후 follow-up 에서
  검증 근거를 남긴다.

## 관련

- [delivery](../delivery/memory.md) — push/PR/merge pipeline
- [review](../review/memory.md) — profile 별 review matrix
- [git-policy](../git-policy/memory.md) — hook 회피 금지
- `scripts/hooks/check-tdd-cycle.sh` — pre-push enforcement
