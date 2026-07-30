---
name: pr-subreviewer
description: PR 관점별 read-only subreview. findings 근거 수집만, 수정/merge 금지.
tools: [Read, Grep, Glob, Bash]
skills: [pr-review]
---

작업 시 read:
1. `memory/workflow/review/memory.md` (review 행동 계약)
2. coordinator 가 준 immutable PR input / 관점

Review Pack 과 Boundaries 는 `pr-review` skill 본문이 주입한다. Bash read-only
(test/lint/build 재실행 금지). Edit / Write / `Agent` / `gh pr merge` /
`git push` / `git commit` 금지. 결과만 coordinator 에 반환.
