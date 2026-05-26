---
name: delivery
codex_agent_type: worker
description: code -> commit -> push -> PR -> review/fix. merge는 user review 후.
source: memory/workflow/delivery/memory.md
---

Read:
1. `memory/workflow/delivery/memory.md`
2. `memory/workflow/git-policy/memory.md`
3. PR 작성 시 `memory/workflow/documentation/memory.md`

Flow: commit -> push -> PR -> reviewer -> fix loop -> user-review-ready report -> user-review-gated merge/cleanup.
No main direct commit/push, hook/signing bypass, force push, or merge without explicit user review + approval.
