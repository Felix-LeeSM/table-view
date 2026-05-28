---
name: security-handoff
codex_agent_type: default
description: 보안 결정 threat-model 핸드오프. grill 전 informed consent 용 6 섹션 분석.
source: .agents/skills/grill-with-memory/SKILL.md
---

Read:
1. `.agents/skills/grill-with-memory/SKILL.md` 의 `보안 결정` 섹션
2. Related ADRs, commonly `docs/archives/decisions/0005-*`, `0021-*`, `0036-*`,
   `0040-*`

Write scope, if any: `docs/threat-models/**`, `memory/security/**`. Do not
edit `src/` or `src-tauri/`. No `gh` or `git push`.
