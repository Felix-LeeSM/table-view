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

- `pre-tool-use.sh` — neutral PreToolUse/PermissionRequest wrapper (Claude Code +
  codex 공유). policy 스크립트의 exit 1 을 JSON `permissionDecision:"deny"` +
  exit 0 으로 변환. Claude Code 는 PreToolUse **exit 2 만 block** 하고 exit 1 은
  non-blocking("Execution continues")이므로, 이 변환이 없으면 매니페스트에서
  policy 스크립트를 직접 부를 때 차단이 무시된다. 단일 변환 layer — policy
  스크립트 자체는 brain-agnostic 하게 exit code 만 내도록 유지.
- `check-edit-policy.sh` — Edit/Write hard blocks and advisory warnings.
- `check-dangerous-bash.sh` — Bash command policy.
- `check-main-worktree-source-edit.sh` — primary-worktree source/app edit guard.
- `check-worktree-bootstrap.sh` — linked-worktree Rust cache guard before Cargo
  pre-commit gates.
- `check-signed-commits.sh` — pre-push outgoing signed-commit gate.
- `pre-push-path-router.sh` — path-sensitive pre-push TS/Rust gate router.
- `post-tool-use.sh` — post-edit formatter/check dispatcher.
