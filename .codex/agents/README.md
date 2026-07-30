# `.codex/agents/` — Codex agent wrappers

Codex currently exposes built-in sub-agent roles (`default`, `explorer`,
`worker`) rather than arbitrary repo-defined agent names. These files are thin
role wrappers and map each repo workflow to a Codex built-in role.

**Every `.md` here is a pointer to `.claude/agents/<name>.md`, which is the
policy source of truth for that agent** (tools, model, `skills:`, prohibitions);
that file in turn points at `memory/` rooms and `.agents/skills/` bodies. This
rule was already written here and was not enforced: 8 of 9 pairs had drifted
bodies, including one pair whose role was the exact opposite on each side, and a
behaviour rule that existed only on this side with no source anywhere (#1975).
Pointing at one file removes the surface rather than policing it.

**Exactly one exception, and it is enforced by a guard.**
`pr-reviewer.md` also carries the verdict label procedure, because
`scripts/hooks/policy/check-verdict-label-contract.sh` lists this path in
`REQUIRED_SOTS` and fails when its red branch is missing (#1884). Reducing that
file to a bare pointer makes that guard exit 1.

`skills:` is a Claude Code injection field with no Codex equivalent. Read the
named `.agents/skills/<name>/SKILL.md` directly instead. `tools:` in the source
is a permission ceiling, not a Codex capability list.

**Line cap: `wc -l` over the whole file, frontmatter included, `README.md`
excluded — `.codex/agents` is ≤ 15.** Same sentence as `.claude/agents`; the
rationale lives in `scripts/hooks/policy/check-wrapper-cap.sh`. This section
used to be missing here even though the script measures this directory (#1975).

For Codex runtime registration, each wrapper has a matching `.toml` file. The
`.toml` file only points back to the `.md` file. All of them carry exactly
`name` / `description` / `developer_instructions` and **no permission fields** —
so a permission-boundary diff against the `.toml` files would compare empty
sets; the boundary lives in the `source` markdown.

## Mapping

| wrapper | Codex role | source |
|---|---|---|
| `issue-refine` | `explorer` | `.claude/agents/issue-refine.md` |
| `issue-implement` | `worker` | `.claude/agents/issue-implement.md` |
| `pr-reviewer` | `explorer` | `.claude/agents/pr-reviewer.md` |
| `pr-subreviewer` | `explorer` | `.claude/agents/pr-subreviewer.md` |
| `research` | `explorer` | `.claude/agents/research.md` |
| `security-handoff` | `default` | `.claude/agents/security-handoff.md` |
| `codex-reviewer` | `default` | `.claude/agents/codex-reviewer.md` |

`bug-fix`, `tdd-generator`, `delivery` and `grill-planner` were retired in
#1987; the first three collapse into `issue-implement` and the fourth had no way
to run an interview (no channel to ask the user back).

Claude Code path-trigger rules (`.claude/rules/`) have no Codex equivalent, so
there is no `.codex/rules/` copy. Their content reaches Codex through the
`source` markdown each wrapper points at.
