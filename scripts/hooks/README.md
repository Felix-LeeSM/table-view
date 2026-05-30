# `scripts/hooks/`

Hook-facing scripts live here. They are called by runtime hook wrappers such as
`.claude/settings.json`, `.codex/hooks/*.sh`, `.githooks/*`, and `lefthook.yml`.

Rules:

- Git / verification scripts are read-only gates: inspect current state, emit
  pass/fail diagnostics, and do not repair state.
- Do not mutate repository state from verification scripts.
- Agent hook wrappers may run explicit formatter/linter/check dispatchers after
  tool use. Keep that behavior visible in the wrapper or dispatcher name; do not
  hide repair behavior inside a script described as verification-only.
- Pass/fail policy details live in the hook scripts and tests, not memory.
- Git formatter/fix steps must be explicit formatter steps in `lefthook.yml`;
  agent formatter/fix steps must be explicit in the wrapper or dispatcher name.
- Shared business/tooling CLIs stay outside this directory until they are proven hook-only.
- Agent-specific wrappers stay in the runtime directory and delegate here.

Current dispatchers:

- `check-edit-policy.sh` — Edit/Write hard blocks and advisory warnings.
- `check-dangerous-bash.sh` — Bash command policy.
- `check-main-worktree-source-edit.sh` — primary-worktree source/app edit guard.
- `check-worktree-bootstrap.sh` — linked-worktree Rust cache guard before Cargo
  pre-commit gates.
- `check-signed-commits.sh` — pre-push outgoing signed-commit gate.
- `pre-push-path-router.sh` — path-sensitive pre-push TS/Rust gate router.
- `post-tool-use.sh` — post-edit formatter/check dispatcher.
