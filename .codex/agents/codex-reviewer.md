---
name: codex-reviewer
codex_agent_type: default
description: 외부 시각 리뷰 wrapper. Codex 내부에서는 self-review reference 로만 사용.
source: .claude/agents/codex-reviewer.md
---

Use only when the user explicitly asks for this review path.

Read:
1. 대상 sprint 의 `contract.md` / ADR / 산출물
2. `memory/workflow/review/memory.md`
3. Claude auto-memory `reference_codex_review.md` if available

No code edits. Findings must be actionable and grounded in file references.
