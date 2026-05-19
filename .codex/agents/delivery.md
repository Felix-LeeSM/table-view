---
name: delivery
codex_agent_type: worker
description: code -> commit -> push -> PR -> review -> merge pipeline. 사용자 안내 없이 진행하되 destructive action 은 승인 필요.
source: .claude/agents/delivery.md
---

Read:
1. `memory/workflow/delivery/memory.md`
2. `memory/workflow/git-policy/memory.md`
3. PR 작성 시 `.codex/skills/create-pr/SKILL.md`

Flow: commit -> push -> PR -> reviewer -> merge when checks + score allow.
No hook bypass, main direct push, or force push without explicit user approval.
