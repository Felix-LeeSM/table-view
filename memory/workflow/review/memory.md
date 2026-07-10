---
title: PR Review Behavior
type: workflow-rule
updated: 2026-07-02
task: review, pr-reviewer, delivery
trigger:
  signal: PR 생성 / 사용자가 "리뷰해" / delivery T4
  layer: index
---

# PR Review Behavior

Workflow memory는 review 방법론을 저장하지 않는다. 이 방은 PR review phase에서
agent가 반드시 취해야 할 행동 계약만 둔다. 평가 차원, profile 분기, scorecard
형식은 `.agents/skills/pr-review/SKILL.md`가 source of truth다.

## 행동 계약

- PR이 생성되면 delivery owner는 독립 `pr-reviewer` coordinator를 1회 붙인다.
- Coordinator는 `.agents/skills/pr-review/SKILL.md`를 적용한다.
- Coordinator는 변경 규모/위험이 있으면 관점별 read-only `pr-subreviewer`를
  fan-out 할 수 있다. 같은 관점 중복 spawn은 금지한다.
- Coordinator와 subreviewer는 read-only다. commit, push, merge, branch 수정 금지.
- Reviewer는 test/lint/build를 재실행하지 않는다. 자동 gate 결과와 PR diff,
  PR body, sprint contract, 필요한 active SOT만 읽는다.
- Subreview 결과는 coordinator의 입력이다. Coordinator는 PR에 직접 하나의
  통합 scorecard와 action items를 repo-relative evidence로 comment한다.
- Review verdict는 `8/10` 기준이다. 적용 차원 중 하나라도 8 미만이면
  red/blocking, 모두 8 이상이면 green/pass다.
- Scorecard의 차원별 `N/10` 표는 **어떤 경우에도 생략 금지** — 요청자가 반환
  형식을 GREEN/RED 등으로 좁게 지정해도, delta 재검증이어도 표를 출력한다.
  (2026-07-04 실제 회귀: 요청 프롬프트의 반환 형식 지정이 rubric을 밀어냄.)
- Verdict는 label로 공표한다: green이면 `gh pr edit <N> --add-label
  review:approved --remove-label review:changes-requested`, red면
  `--add-label review:changes-requested`. reviewer의 write는 scorecard
  comment와 verdict label 두 가지가 전부다(그 외 write 금지).
  `review:approved`는 `review-gate` required check의 pass 조건이다
  (계정 1개 = GitHub review approval 불가의 label 우회).
- 결함이 있으면 delivery owner가 수정하고 push한 뒤 review를 다시 요청한다.
- Merge 판단은 delivery owner 책임이다. Reviewer pack은 판단 input만 제공한다.
- External reviewer는 사용자가 명시적으로 요청했을 때만 추가한다.

## Merge 전 요구

- 자동 gate와 CI가 green이어야 한다. `review-gate` check는
  `review:approved` label이 있어야 pass — branch protection required check +
  enforce_admins라 우회 불가. 새 commit push 시 label이 자동 해제되므로
  fix 후에는 재리뷰가 필수다.
- 적용된 정성 차원이 통과해야 한다.
- PR이 mergeable이고 branch policy block이 없어야 한다.
- 사용자 명시 거부가 없어야 한다.

## 관련

- `.agents/skills/pr-review/SKILL.md` — review 방법론
- `.claude/agents/pr-reviewer.md` / `.codex/agents/pr-reviewer.md` — runtime wrappers
- [delivery](../delivery/memory.md) — commit → push → PR → review → merge pipeline
- [documentation](../documentation/memory.md) — PR body와 documentation impact gate
- `scripts/review/run-checks.sh` — sprint Required Checks runner
