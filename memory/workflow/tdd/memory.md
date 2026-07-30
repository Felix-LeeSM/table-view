---
title: TDD Evidence
type: workflow-rule
updated: 2026-07-03
task: tdd, delivery, pre-push, sprint
trigger:
  signal: code-profile sprint, RED commit, TDD-cycle hook
  layer: agent-prompt + pre-push
---

# TDD Evidence

본 문서는 작업 방식을 마이크로매니징하지 않는다. 역할은 delivery gate 가 요구하는
evidence 를 작업 초반에 보이게 하는 것.

## 강제하지 않는다 — 권고다 (2026-07-30 사용자 결정, #1987)

**실패하는 테스트를 먼저 커밋하는 것은 품질 수단이지 통과 조건이 아니다.**
먼저 커밋하지 않아도, 먼저 작성하지 않아도 문제가 되지 않는다. 유도는
`issue-implement` description 과 `tdd` skill 본문(`skills:` 주입)이 한다.

관련 사실 둘. (1) 옛 판이 "RED 강제는 훅이 이미 갖고 있다"(#1918) 고 적었는데
거짓이었다 (#1975) — `check-tdd-cycle.sh` 는 브랜치명에서 `sprint-[0-9]+` 를 못
뽑으면 `exit 0` 이고 최근 머지 100건 어디에도 `sprint` 이 없다
(`gh pr list --state merged --limit 100 --json headRefName -q '.[].headRefName' | grep -c sprint` → `0`).
(2) 강제가 폐기됐으므로 그 훅의 존재 이유도 없어졌다. **훅 제거는 별건**이다 —
라우터 배선을 건드리는데 그 `check-*.sh` 스텝들에 테스트 보호가 없고(#1989),
훅을 옮기면 열려 있는 다른 세션의 가드가 조용히 꺼진다.

## 아직 남아 있는 훅 조건

`docs/sprints/sprint-N/contract.md` frontmatter 가 `review-profile: code` 이고
브랜치명이 `sprint-N/...` 일 때만 pre-push `check-tdd-cycle.sh` 가
`merge-base..HEAD` 에 RED commit subject 를 요구한다. 그 밖에는 안 돈다.

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
아니다. 훅이 실제로 도는 조건(위)에서 막혔다면 `SKIP_TDD_CYCLE=1` 같은 skip env
는 사용자 명시 승인 없이는 금지.

## 예외

- `review-profile` 이 `docs`, `infra`, `security` 등 code 가 아니면 훅이 안 돈다.
- 긴급 hotfix 에서 skip 이 필요하면 사용자가 명시해야 한다. 이후 follow-up 에서
  검증 근거를 남긴다.

## 관련

- [delivery](../delivery/memory.md) — push/PR/merge pipeline
- [review](../review/memory.md) — profile 별 review matrix
- [git-policy](../git-policy/memory.md) — hook 회피 금지
- pre-push 로 이 사이클을 강제하던 `check-tdd-cycle.sh` 는 삭제됐다 (#2033) — 집행 없음
