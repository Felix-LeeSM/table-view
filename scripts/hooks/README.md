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

## Shared libs (`lib/`)

- `lib/*.sh` are **source-only modules** — pure function definitions, no
  top-level side effects, no executable bit. Consumed via `source` from
  dispatchers (same pattern as `path-classifier.sh`).
- Currently: `lib/locale-utf8.sh` (UTF-8 locale guard), `lib/root-resolve.sh`
  (repository root resolution), `lib/hook-json.sh` (hook JSON field/path parse).
- Adding a new lib: it is automatically covered by the `scripts/hooks/lib/*.sh`
  glob in the `hook-shell-syntax` gate (`pre-push-path-router.sh`). Do **not**
  put top-level execution code in a lib — it runs on every `source` and breaks
  callers running under `set -euo pipefail`.

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
- `pr-create-reminder.sh` — PostToolUse(Bash) soft 넛지: 명령이 `gh pr create` 를
  포함하면 델리버리 T4(pr-reviewer read-only) 리뷰를 잊지 않도록 additionalContext
  리마인더만 낸다. block 하지 않음(사용자 결정: hook 강제 대신 soft). Claude Code +
  codex 공유 — `.claude/settings.json` + `.codex/hooks.json` PostToolUse(Bash) 양쪽이
  동일 스크립트를 호출한다.

## Memory / doc size cap thresholds

- `check-memory-size.sh` — `memory.md` 복합 cap: 200줄 + 12,000 chars. 어느 하나라도
  초과 시 경고, `--strict` 시 block. override: `MEMORY_LINE_THRESHOLD`,
  `MEMORY_CHAR_THRESHOLD`. (pre-push `--strict` 전용.)
- `check-doc-size.sh` — docs 지속 참조 문서 chars cap: 120,000 (advisory). 일회성
  산출물(`docs/{sprints,archives,table_plus,explorations}`)은 제외. override:
  `DOCS_CHAR_THRESHOLD`. ratchet 시점에 threshold 를 내려 분할을 유도한다.
  (CI advisory 전용 — memory-size 와 정책 분리.)
