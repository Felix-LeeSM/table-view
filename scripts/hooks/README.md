# `scripts/hooks/`

Hook-facing scripts live here. They are called by runtime hook wrappers such as
`.claude/settings.json`, `.codex/hooks/*.sh`, `.githooks/*`, and `lefthook.yml`.

Rules:

- Verification scripts must be read-only unless they are formatter-style staged-file fixes.
- No `git fetch`, `git pull`, `git push`, ref mutation, branch switching, or stash.
- Shared business/tooling CLIs stay outside this directory until they are proven hook-only.
- Agent-specific wrappers stay in the runtime directory and delegate here.

Current dispatchers:

- `check-edit-policy.sh` — Edit/Write hard blocks and advisory warnings.
- `check-dangerous-bash.sh` — Bash command policy.
- `check-signed-commits.sh` — pre-push outgoing signed-commit gate.
- `post-tool-use.sh` — post-edit formatter/check dispatcher.
