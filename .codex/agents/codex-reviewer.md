---
name: codex-reviewer
codex_agent_type: default
description: 외부 시각 리뷰. 사용자 명시 호출 시만. 코드 수정 0, 결과는 반환값으로만 낸다.
source: .claude/agents/codex-reviewer.md
---

정책 본문은 `source` 가 소유한다. 이 wrapper 는 Codex built-in role 매핑만 하고
룰을 복제하지 않는다 (`.codex/agents/README.md`). source 를 먼저 읽고 거기
나열된 경로를 따른다.

source 의 `skills:` 는 Claude Code 전용 주입 필드다 — Codex 에서는 그 이름의
`.agents/skills/<name>/SKILL.md` 를 직접 읽는다. `tools:` 는 권한 상한이다.
