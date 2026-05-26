---
name: harness
description: >
  Thin runner for the repo harness workflow. Source of truth lives in
  memory/workflow/harness/memory.md. Usage: /harness <feature-description>
argument-hint: <feature-description>
---

# Harness Runner

This skill is a pointer/runner, not the policy source of truth.

Read before any harness run:

1. `AGENTS.md`
2. `memory/workflow/harness/memory.md`
3. `memory/workflow/harness/principles/memory.md`
4. `memory/workflow/harness/run-ledger/memory.md`
5. `memory/workflow/harness/agents/memory.md`
6. `memory/terminology/memory.md`
7. `memory/index/by-task.md`
8. relevant memory/docs/ADR/code entrypoints from the Thin Read Pack

Follow `memory/workflow/harness/` for workflow policy:

- run ledger / `run.md`
- worker topology
- Thin Read Pack
- evidence-only pass updates
- context budget
- artifact routing
- terminology gate terms / collision locks
- human-readable handoff for user review

Runtime-local files:

- prompts/templates: `.claude/skills/harness/`
- sprint artifacts: `docs/sprints/sprint-N/`

Use templates as shapes only:

- `.claude/skills/harness/templates/run.md`
- `.claude/skills/harness/templates/contract.md`
- `.claude/skills/harness/templates/execution-brief.md`
- `.claude/skills/harness/templates/findings.md`
- `.claude/skills/harness/templates/handoff.md`

If this skill conflicts with `memory/workflow/harness/memory.md`, memory wins.
