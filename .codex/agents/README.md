# `.codex/agents/` — Codex agent wrappers

Codex currently exposes built-in sub-agent roles (`default`, `explorer`,
`worker`) rather than arbitrary repo-defined agent names. These files are thin
role wrappers and map each repo workflow to a Codex built-in role.

The source of truth remains `memory/`; these wrappers are pointers, not
duplicated policy. Agent spawning follows the workflow memory and the active
runtime's tool policy.

## Mapping

| wrapper | Codex role | source |
|---|---|---|
| `bug-fix` | `worker` | `memory/workflow/bug-fix/memory.md` |
| `tdd-generator` | `worker` | `.agents/skills/tdd/SKILL.md` + testing memory |
| `delivery` | `worker` | `memory/workflow/delivery/memory.md` |
| `research` | `explorer` | `memory/workflow/implementation/memory.md` |
| `pr-reviewer` | `explorer` | `memory/workflow/review/memory.md` |
| `grill-planner` | `default` | `memory/workflow/grill/memory.md` |
| `security-handoff` | `default` | `memory/workflow/grill/security-handoff/memory.md` |
| `codex-reviewer` | `default` | `memory/workflow/review/memory.md` |
| `caveman-default` | `default` | `.agents/skills/caveman/SKILL.md` |

Rules in Claude Code path-trigger wrappers are platform glue only. Their real
content is in `memory/`, so no separate `.codex/rules/` copy is needed unless
Codex adds a path-triggered rules mechanism.
