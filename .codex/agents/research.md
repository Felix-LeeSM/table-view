---
name: research
codex_agent_type: explorer
description: 코드 / 문서 / 외부 자료 탐색만. 코드 변경 0.
source: .claude/agents/research.md
---

Use only when sub-agents are explicitly authorized.

Read:
1. `memory/workflow/implementation/memory.md`
2. Relevant `memory/index/by-surface.md` entries for the target area

Output format: `발견: <fact> - <file:line>`, `미확정: ...`,
`추천 follow-up: ...`. No Edit, Write, or mutating Bash.
