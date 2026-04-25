# Sprint 120 Evaluation Findings

## Sprint 120 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 9/10 | All 7 acceptance criteria met. `assertNever` signature `(value: never): never` at `src/lib/paradigm.ts:12` matches the contract. `MainArea.tsx:120` uses `default: return assertNever(paradigm)` inside an exhaustive switch, which is the only structurally correct way to make the union-narrowing detection work at compile time — a one-line append to the original `if (isDocument)` block could not have produced exhaustiveness checking. JSX bodies preserved verbatim inside switch cases (only indentation changed). `tab.paradigm ?? "rdb"` fallback matches Sprint 84's restore semantics. |
| **Completeness** (25%) | 9/10 | 7 git renames detected (R-marks via `git diff -M --summary HEAD`): `DataGrid.tsx` (99% — 1 line FilterBar import update), `DataGrid.test.tsx`, `FilterBar.tsx`, `FilterBar.test.tsx`, `DocumentDataGrid.tsx`, `DocumentDataGrid.test.tsx`, plus `DocumentDataGrid.pagination.test.tsx` (correctly moved with sibling — relative `import "./DocumentDataGrid"` would have broken otherwise; not in contract list but mandatory for invariants). `paradigm.test.ts` has 2 cases (throw + message-includes-value), satisfying contract's "1-2 cases" allowance. Mock specifier in `MainArea.test.tsx:14` updated. |
| **Reliability** (20%) | 9/10 | All required checks pass: tsc 0 errors, lint 0 errors, vitest 1847/1847 (1845 baseline + 2 new). `src-tauri/` diff empty (AC-05). `useDataGridEdit.ts` diff empty (AC-06). `grep -rn -E 'from "(@components|@/components)/(DataGrid\|FilterBar\|DocumentDataGrid)["/]' src/` returns 0 matches (AC-07 + check 7). The `case "search"` and `case "kv"` fall-throughs to RDB UI are documented as logically unreachable (no connection store factory creates them) — handoff §"리스크 (낮음)" calls this out explicitly. |
| **Verification Quality** (20%) | 8/10 | Generator captured all 6 mandated check outputs. Evidence for AC-04 is precise (file:line). One minor gap: handoff cites `MainArea.tsx:131` for `assertNever` call but actual line is 120 in the post-write file (off by 11 — likely captured before a comment edit). Not P1/P2; numbers are still verifiable via `grep -n 'assertNever(paradigm)' src/components/layout/MainArea.tsx`. |
| **Overall** | **8.85/10** | Weighted: 35×9 + 25×9 + 20×9 + 20×8 = 315+225+180+160 = 880/100 = 8.8. |

## Verdict: PASS

All four dimensions ≥ 7. No P1 or P2 issues.

## Sprint Contract Status (Done Criteria)

- [x] **AC-01** — All imports updated; `pnpm tsc --noEmit` exit 0. `grep -rn -E 'from "(@components|@/components)/(DataGrid|FilterBar|DocumentDataGrid)["/]' src/` returns 0 matches.
- [x] **AC-02** — `pnpm lint` exit 0; `pnpm vitest run` 1847/1847 (1845 baseline + 2 from `paradigm.test.ts`).
- [x] **AC-03** — `git diff -M --summary HEAD` shows 7 rename markers (DataGrid.tsx at 99%, all others 100%). Content diff confined to: `rdb/DataGrid.tsx` (1 line FilterBar import), `MainArea.tsx` (switch refactor + 2 import path lines + 1 new lib import), `MainArea.test.tsx` (1 line mock specifier).
- [x] **AC-04** — `src/lib/paradigm.ts:12` exports `function assertNever(value: never): never`. `src/components/layout/MainArea.tsx:120` calls `return assertNever(paradigm)` as the `default:` arm of the exhaustive switch in `TableTabView`.
- [x] **AC-05** — `git diff --stat HEAD -- src-tauri/` empty.
- [x] **AC-06** — `git diff --stat HEAD -- src/components/datagrid/useDataGridEdit.ts` empty.
- [x] **AC-07** — No dynamic/`lazy()` imports detected; static-only updates verified by grep.

## Verification Plan Execution

| Check | Expected | Actual |
|-------|----------|--------|
| `pnpm tsc --noEmit` | exit 0 | exit 0 |
| `pnpm lint` | exit 0 | exit 0 |
| `pnpm vitest run` | 1847/1847 | 110 files / 1847 tests / all passed (18.60s) |
| `git diff -M --stat HEAD` rename markers | 6 (contract) / 7 (handoff justified) | 7 rename markers (justified — pagination test relative-imports DocumentDataGrid) |
| `git diff --stat HEAD -- src-tauri/` | empty | empty |
| `git diff --stat HEAD -- src/components/datagrid/useDataGridEdit.ts` | empty | empty |
| Old-path import grep | 0 matches | 0 matches |

## Feedback for Generator

1. **Line-number drift in evidence packet**: handoff §"AC Coverage" cites `MainArea.tsx:131` for the `assertNever` call, but the actual line in the committed file is `120`. Either the file was further edited after the handoff was drafted, or the line count was approximated.
   - Current: handoff line 45 says "`src/components/layout/MainArea.tsx:131` `default: return assertNever(paradigm);`".
   - Expected: line number should match HEAD of the working tree.
   - Suggestion: re-grep with `grep -n 'assertNever(paradigm)' src/components/layout/MainArea.tsx` immediately before writing the handoff.

2. **Contract vs. brief tension on MainArea scope**: contract §"Out of Scope" says "MainArea.tsx의 paradigm 분기 로직 변경" is out of scope, but AC-04 + the brief mandate adding `assertNever` (which structurally requires a switch). The switch refactor is the right call (early-return + assertNever cannot narrow the union to `never`), but the ambiguity should be flagged when a future contract has the same pattern.
   - Current: handoff §"구현 노트" describes the switch wrapper but doesn't cite the contract's "분기 로직 변경 out-of-scope" caveat.
   - Expected: explicit reconciliation — "AC-04 implies a switch wrapper, which logically supersedes the 'no logic change' caveat for this single fork point."
   - Suggestion: add a one-line note to handoff §"구현 노트" calling this out.

3. **Bonus rename not in contract**: `DocumentDataGrid.pagination.test.tsx` was correctly moved (relative import would have broken), but the contract listed only 6 renames. The handoff explains this in §"구현 노트" — good practice. Consider raising a contract amendment in real time next sprint for this kind of mandatory bonus.

4. **`Paradigm` re-export uses `export type { Paradigm }` then re-imports as type**: minor — this pattern is fine but adds a hop. A direct `export type { Paradigm } from "@/types/connection";` would be one fewer line. Not a blocker.

## Handoff Artifacts

- Findings: `docs/sprints/sprint-120/findings.md` (this file).
- Sprint Contract: `docs/sprints/sprint-120/contract.md`.
- Sprint Brief: `docs/sprints/sprint-120/execution-brief.md`.
- Generator Handoff: `docs/sprints/sprint-120/handoff.md`.
