---
title: PR Review Behavior
type: workflow-rule
updated: 2026-07-27
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
- `pr-reviewer`는 top-level 전용 coordinator다(하네스가 subagent 중첩 spawn을
  막음). 스스로 판단해 필요하면 관점별 read-only `pr-subreviewer`를 fan-out
  한다 — 항상-spawn이 아니라 자율 판단이고, 소형 PR 단독 검증도 유효한 경로다.
  fan-out 기준(diff 규모/파일수/영역수)과 fallback은 SKILL.md Review Pack이
  SOT다. 같은 관점 중복 spawn은 금지한다.
- `pr-subreviewer` spawn이 실패하면(중첩 spawn 불능 포함) coordinator는 같은
  관점들을 순차 단독 검증으로 강등해 수행하고, scorecard에 "fan-out 불가로 단독
  강등" 사실을 명시한다.
- Coordinator와 subreviewer는 read-only다. commit, push, merge, branch 수정 금지.
- Reviewer는 test/lint/build를 재실행하지 않는다. 자동 gate 결과와 PR diff,
  PR body, sprint contract, 필요한 active SOT만 읽는다.
- Subreview 결과는 coordinator의 입력이다. Coordinator는 PR에 직접 하나의
  통합 scorecard와 action items를 repo-relative evidence로 comment한다.
- Blocking은 SKILL.md Verdict 원칙 1의 세 사유뿐이다(런타임·보안 / 이 PR 귀책의
  거짓이 SOT에 들어감 / 자동 layer 실패). 그 외 발견은 non-blocking이고 이슈로
  배출한다. 점수 기준은 쓰지 않는다 — 앵커가 없어 판정을 대신해 왔다.
- Blocking 판정은 coordinator 단독 권한이다. subreviewer는 발견과 근거만 내고
  severity를 붙이지 않는다. 관점을 늘려도 blocking이 늘지 않는다.
- Scorecard의 차원별 판정 표는 **어떤 경우에도 생략 금지** — 요청자가 반환
  형식을 GREEN/RED 등으로 좁게 지정해도, delta 재검증이어도 표를 출력한다.
  (2026-07-04 실제 회귀: 요청 프롬프트의 반환 형식 지정이 rubric을 밀어냄.)
- Verdict는 label로 공표한다. **명령 2개로 나눠 치고 사이를 30초 이상 벌린다** —
  한 명령에 `--add-label`과 `--remove-label`을 같이 쓰면 같은 초에 두 이벤트가
  나고 `cancel-in-progress`가 run 하나를 죽인다. 죽은 run이 rollup에 non-success로
  남아 BLOCKED가 고착된다(#1879 실측). 순서는 게이트가 먼저 옳은 상태가 되는 쪽:

  ```
  green: gh pr edit <N> --add-label review:approved
         (30초 이상)
         gh pr edit <N> --remove-label review:changes-requested
  red:   gh pr edit <N> --remove-label review:approved
         (30초 이상)
         gh pr edit <N> --add-label review:changes-requested
  ```

  red에서 `review:approved`를 먼저 떼는 것이 필수다. 안 떼면 같은 SHA를 재리뷰해
  green이 red로 뒤집혀도 label이 남아 `review-gate`가 pass한다 — `Dismiss stale
  approval`은 `synchronize` 전용이라 push 없는 뒤집기를 못 잡는다(#1884).
- reviewer의 write는 scorecard comment, verdict label, non-blocking 발견의
  `gh issue create` 세 가지가 전부다(그 외 write 금지). 원칙 1이 blocking을
  좁히므로 배출구가 없으면 발견이 기록 없이 증발한다.
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
- 정성 차원에 blocking 이 없어야 한다 — 위 행동 계약의 blocking 정의를 그대로
  쓴다. 이 절은 별도 기준을 세우지 않는다.
- PR이 mergeable이고 branch policy block이 없어야 한다.
- 사용자 명시 거부가 없어야 한다.

## 관련

- `.agents/skills/pr-review/SKILL.md` — review 방법론
- `.claude/agents/pr-reviewer.md` / `.codex/agents/pr-reviewer.md` — runtime wrappers
- [delivery](../delivery/memory.md) — commit → push → PR → review → merge pipeline
- [documentation](../documentation/memory.md) — PR body와 documentation impact gate
- `scripts/review/run-checks.sh` — sprint Required Checks runner
