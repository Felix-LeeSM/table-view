---
name: delivery
codex_agent_type: worker
description: code -> commit -> push -> PR -> review -> merge pipeline. 사용자 안내 없이 진행하되 destructive action 은 승인 필요.
source: memory/workflow/delivery/memory.md
---

Read:
1. `memory/workflow/delivery/memory.md`
2. `memory/workflow/git-policy/memory.md`
3. PR 작성 시 `memory/workflow/documentation/memory.md`

Flow: commit -> push -> PR -> reviewer -> merge/blocked report -> cleanup.
No hook/signing bypass, main direct push, or force push without explicit user approval.
