# `scripts/hooks/`

Hook-facing scripts live here. They are called by runtime hook wrappers such as
`.claude/settings.json`, `.codex/hooks/*.sh`, `.githooks/*`, and `lefthook.yml`.

## Layers

A script belongs to exactly one layer, named by the question it answers:

| dir | question | may it decide? |
|---|---|---|
| `analyze/` | what IS this input? | no — emits facts only |
| `policy/` | may this be allowed? | yes — exit code IS the verdict |
| `apply/` | what fires, and how is the verdict shaped for the caller? | no — dispatches and formats |
| `lib/` | shared source-only helpers | no |

Why: `check-main-worktree-source-edit.sh` was 892 lines doing analysis and
policy at once, and most of its recorded denials were reader defects wearing a
policy message — indistinguishable from a real block, because the only
observable was "denied". (Of 293 replayed denials, 273 were released by fixing
the reader; the 20 that remain mix genuine blocks with residual artifacts.)
Splitting the two made the reader
directly testable — `analyze/test-bash-write-targets.sh` asks "which paths?",
never "denied?".

Placement test when adding a script: if it can be exercised without a repository
it is `analyze/`; if its exit code answers allow/deny it is `policy/`; if it
reads a hook event or writes hook JSON it is `apply/`. A `test-*.sh` lives beside
its subject; a contract test with no subject script (workflow/release assertions)
is `policy/` — it decides whether a repo artifact passes.

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
  dispatchers (same pattern as `analyze/path-classifier.sh`).
- Currently: `lib/locale-utf8.sh` (UTF-8 locale guard), `lib/root-resolve.sh`
  (repository root resolution), `lib/hook-json.sh` (hook JSON field/path parse),
  `lib/git-fixture.sh` (throwaway fixture repositories for the test suites).
- `lib/test-*.sh` is the one exception to source-only, and only that name: a
  suite for the module beside it, run by `apply/pre-push-path-router.sh` and
  never sourced. Tests live next to what they test everywhere else here
  (`policy/test-*.sh`, `analyze/test-*.sh`); a lib is not exempt from having one.
- Adding a new lib: it is automatically covered by the `scripts/hooks/lib/*.sh`
  glob in the `hook-shell-syntax` gate (`apply/pre-push-path-router.sh`). Do
  **not** put top-level execution code in a lib — it runs on every `source` and
  breaks callers running under `set -euo pipefail`.

## Analyzers (`analyze/`)

- `path-classifier.sh` — repo-relative path -> surface class.
- `bash-write-targets.sh` — approximate bash command -> the absolute paths it
  would write. Knows nothing about repositories or policy; the caller supplies
  `BASH_WRITE_TARGETS_CWD`. Ceilings are documented per function, and the two
  the caller's tests cannot express (a `sed -i` expression is emitted next to the
  real target; a variable write target is opaque) are pinned in its own suite.

Current dispatchers:

- `apply/pre-tool-use.sh` — neutral PreToolUse/PermissionRequest wrapper (Claude Code +
  codex 공유). policy 스크립트의 exit 1 을 JSON `permissionDecision:"deny"` +
  exit 0 으로 변환. Claude Code 는 PreToolUse **exit 2 만 block** 하고 exit 1 은
  non-blocking("Execution continues")이므로, 이 변환이 없으면 매니페스트에서
  policy 스크립트를 직접 부를 때 차단이 무시된다. 단일 변환 layer — policy
  스크립트 자체는 brain-agnostic 하게 exit code 만 내도록 유지.
- `apply/check-edit-policy.sh` — Edit/Write hard blocks and advisory warnings.
- `policy/check-dangerous-bash.sh` — Bash command policy.
- `policy/check-main-worktree-source-edit.sh` — primary-worktree source/app edit guard.
- `policy/check-worktree-bootstrap.sh` — linked-worktree Rust cache guard before Cargo
  pre-commit gates.
- `policy/check-signed-commits.sh` — pre-push outgoing signed-commit gate.
- `analyze/detect-change-scope.sh` — classifies a change set into two independent
  signals, `code_changed` and `docs_changed`. The second exists because a
  docs-only change is not "no change": the vitest suite holds the doc contracts
  and `pnpm lint` reads the 20 `COMPLETION_FEATURE_REFERENCE_DOC_PATHS` plus the
  frontend-compat inventory, so the jobs running those must fire on a docs-only
  PR (#1841 merged with its doc contracts unevaluated; #1844 and #1847 merged
  reading `Frontend Checks: skipping`). Any ambiguity sets both to true.
  Tests: `test-detect-change-scope.sh`; the CI wiring — exactly which jobs carry
  the `docs_changed` clause — is asserted in `test-ci-workflow-cache.sh` against
  the `DOCS-READING JOBS` note in `.github/workflows/ci.yml`.
  - Ceiling: that assertion runs at pre-push on `.github/workflows/*` edits, not
    as its own CI job, so dropping the clause is caught locally rather than
    remotely.
- `apply/pre-push-path-router.sh` — path-sensitive pre-push TS/Rust gate router. Also
  runs `scripts/check-memory-paths.ts` (reverse code->memory path-citation gate)
  when memory changes or a push drops/renames a path, and
  `scripts/check-agents-matrix-coverage.ts` (issue #1755 — fails when a memory
  room referenced by >=7 by-task intents is missing from the `AGENTS.md` matrix)
  when memory or `AGENTS.md` changes.
- `apply/post-tool-use.sh` — post-edit formatter/check dispatcher.
- `apply/pr-create-reminder.sh` — PostToolUse(Bash) soft 넛지: 명령이 `gh pr create` 를
  포함하면 리뷰 단계(pr-reviewer read-only)를 잊지 않도록 additionalContext
  리마인더만 낸다. block 하지 않음(사용자 결정: hook 강제 대신 soft). Claude Code +
  codex 공유 — `.claude/settings.json` + `.codex/hooks.json` PostToolUse(Bash) 양쪽이
  동일 스크립트를 호출한다.

## Routing 계측 (opt-in, 로컬 전용)

`apply/surface-routing.sh` 가 룰을 주입할 때 `routing.rule.delivered` 카운터를
낸다. `OTEL_EXPORTER_OTLP_ENDPOINT` 가 없으면 **아무 것도 하지 않는다** —
설정 방법과 무엇을 보는지는 `scripts/otel/collector-local.yaml` 상단 주석이
SOT. 네트워크로 내보내는 exporter 추가는 제품 텔레메트리 결정이므로 ADR 필요
(ADR 0036 telemetry zero-collection).

측정 대상은 "룰이 도달했는가" 가 아니라 **"도달한 룰을 읽었는가"** 다.
`routing.rule.delivered` 와 주입된 `memory/` 경로에 대한 Claude Code 자체
`claude_code.tool_decision`(Read) 사이의 간극이 곧 헤맴 신호다.

## Memory / doc size cap thresholds

- `policy/check-memory-size.sh` — `memory.md` 복합 cap: 200줄 + 12,000 chars. 어느 하나라도
  초과 시 경고, `--strict` 시 block. override: `MEMORY_LINE_THRESHOLD`,
  `MEMORY_CHAR_THRESHOLD`. (pre-push `--strict` 전용.)
- `policy/check-doc-size.sh` — docs 지속 참조 문서 chars cap: 120,000 (advisory). 일회성
  산출물(`docs/{sprints,archives,table_plus,explorations}`)은 제외. override:
  `DOCS_CHAR_THRESHOLD`. ratchet 시점에 threshold 를 내려 분할을 유도한다.
  (CI advisory 전용 — memory-size 와 정책 분리.)
