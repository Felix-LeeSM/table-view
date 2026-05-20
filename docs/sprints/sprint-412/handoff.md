# sprint-412 handoff

## Summary

Added a CI-enforced gzip budget for checked-in parser WASM artifacts and
documented the policy for future parser/WASM sprints.

## Changed Files

- `scripts/check-wasm-size.sh`
  - Checks SQL and Mongo parser `.wasm` gzip sizes against explicit byte budgets.
- `package.json`
  - Adds `pnpm wasm:size`.
- `.github/workflows/ci.yml`
  - Runs the budget check in Frontend Checks.
- `docs/sprints/README.md`
  - Requires a `WASM budget` section for future parser/WASM sprint contracts.
- `README.md`
  - Documents the local command and budget caps.
- `docs/sprints/sprint-412/contract.md`
  - Records scope, current measurements, ACs, and non-goals.

## Guardrails

- Budgets are gzip-compressed bytes, expressed in KiB to avoid `KB` ambiguity.
- Current budgets: SQL ≤ 80 KiB gzip, Mongo ≤ 50 KiB gzip.
- The script reads existing checked-in artifacts; it does not regenerate WASM.

## Validation

- `bash scripts/check-wasm-size.sh`
- `pnpm wasm:size`
- `SQL_WASM_GZIP_BUDGET_BYTES=1 bash scripts/check-wasm-size.sh` fails with the
  expected SQL budget error.
- `bash -n scripts/check-wasm-size.sh`
- `pnpm exec prettier --check README.md docs/sprints/README.md docs/sprints/sprint-412/contract.md docs/sprints/sprint-412/handoff.md package.json .github/workflows/ci.yml`
- `pnpm exec tsc --noEmit`
- `pnpm run lint`
- `git diff --check`
