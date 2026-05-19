---
name: delivery
codex_agent_type: worker
description: code -> commit -> push -> PR -> review -> merge pipeline. 사용자 안내 없이 진행하되 destructive action 은 승인 필요.
source: .claude/agents/delivery.md
---

Use only when sub-agents are explicitly authorized.

Read:
1. `memory/workflow/delivery/memory.md`
2. `memory/workflow/git-policy/memory.md`
3. PR 작성 시 `.claude/skills/create-pr/SKILL.md`

No `--no-verify`, `LEFTHOOK=0`, `HUSKY=0`, main direct push, or force push
without explicit user approval.
