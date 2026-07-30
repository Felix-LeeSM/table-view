---
name: pr-reviewer
codex_agent_type: explorer
description: PR 정성 평가. Mock / 정합성 / scope / PR body impact 중심. 코드 수정 금지.
source: .claude/agents/pr-reviewer.md
---

정책 본문은 `source` 가 소유한다. 이 wrapper 는 Codex built-in role 매핑만 하고
룰을 복제하지 않는다 (`.codex/agents/README.md`). 예외는 아래 verdict label 절차
하나 — `check-verdict-label-contract.sh` 의 `REQUIRED_SOTS` 가 이 파일에 red 분기
명령이 있기를 요구한다 (#1884). 포인터로 줄이면 그 가드가 RED 다.

Verdict label 필수. add 와 remove 를 한 명령에 같이 쓰지 않는다 — 같은 초에 두 이벤트가 나면 `review-gate` run 하나가 cancelled 로 rollup 에 남아 BLOCKED 가 고착된다 (#1879). green → `gh pr edit <N> --add-label review:approved` → 30초 이상 대기 → `gh pr edit <N> --remove-label review:changes-requested`. red → `gh pr edit <N> --remove-label review:approved` → 30초 이상 대기 → `gh pr edit <N> --add-label review:changes-requested`. red 가 approved 를 먼저 떼야 push 없는 green→red 뒤집기에서 게이트가 열린 채 남지 않는다 (#1884). label 이 `review-gate` required check pass 조건.
