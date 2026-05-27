# `scripts/hooks/`

Hook-facing scripts live here. They are called by runtime hook wrappers such as
`.claude/settings.json`, `.codex/hooks/*.sh`, `.githooks/*`, and `lefthook.yml`.

Rules:

- Verification scripts are read-only gates: inspect current state, emit pass/fail
  diagnostics, and do not repair state.
- Do not mutate repository state from verification scripts.
- Pass/fail policy details live in the hook scripts and tests, not memory.
- Formatter/fix steps must be explicit formatter steps in `lefthook.yml`; do not hide
  repair behavior inside verification scripts.
- Shared business/tooling CLIs stay outside this directory until they are proven hook-only.
- Agent-specific wrappers stay in the runtime directory and delegate here.

Current dispatchers:

- `check-edit-policy.sh` — Edit/Write hard blocks and advisory warnings.
- `check-dangerous-bash.sh` — Bash command policy.
- `check-main-worktree-source-edit.sh` — primary-worktree source/app edit guard.
- `check-signed-commits.sh` — pre-push outgoing signed-commit gate.
- `pre-push-path-router.sh` — path-sensitive pre-push TS/Rust gate router.
- `post-tool-use.sh` — post-edit formatter/check dispatcher.
