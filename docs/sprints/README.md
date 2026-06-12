# Sprint Artifacts

Harness sprint outputs live here. Sprint directories are execution records, not
the current product, roadmap, risk, or workflow source of truth.

Prompts/templates stay in `.agents/skills/harness/`; run artifacts go in `docs/sprints/sprint-N/`.

## Policy

- Use project-wide `sprint-N` numbers.
- If `N` is unspecified, use the next unused number.
- Treat `docs/sprints/sprint-N/**` as historical once the sprint is delivered.
  Do not infer shipped support or future sequencing from old contract, handoff,
  findings, evaluation, or red-state text.
- Current product support lives in [`docs/product/README.md`](../product/README.md)
  and [`docs/product/known-limitations.md`](../product/known-limitations.md).
- Future work, promotion gates, and sequencing live in
  [`docs/ROADMAP.md`](../ROADMAP.md) or open GitHub issues.
- Developer-facing verification gaps live in
  [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md).
- Workflow policy lives under `memory/workflow/**/memory.md`; sprint artifacts may
  cite the policy used at the time but do not replace it.
- Historical links to retired paths such as `docs/RISKS.md` or older top-level
  support pages are evidence of that sprint's original context. For current
  state, use the SOT routes above.

## Files

Common files: `spec.md`, `contract.md`, `execution-brief.md`, `findings.md`, `handoff.md`.

## WASM Budget

Any sprint that changes `src-tauri/sql-parser-core/`,
`src-tauri/mongosh-parser-core/`, or the generated `src/lib/**/wasm/`
artifacts must include a `WASM budget` section in `contract.md`. The section
records the gzip byte budget, the measured gzip size after regeneration, and
the validation command (`bash scripts/check-wasm-size.sh`). Current enforced
budgets are SQL parser WASM ≤ 200 KiB gzip (204800 bytes) and Mongo parser WASM
≤ 53 KiB gzip (54272 bytes). `pnpm wasm:size` may remain a local convenience,
but sprint Required Checks should use the script command accepted by the review
runner.
