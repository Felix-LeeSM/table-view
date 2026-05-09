# Evaluator Findings — Sprint 253

- **Profile**: command (all 7 required checks + static spot-checks)
- **Evaluator**: harness Evaluator agent (Opus 4.7, 1M context)
- **Date**: 2026-05-09
- **Verdict**: **PASS**

## Scorecard

| Dimension | Score | Weight | Notes |
|---|---|---|---|
| Correctness | 9/10 | 35% | All 6 ACs satisfied; cursor-X math correct for all edge cases (past-last, between-tabs, before-first); bubble guard works; `--tv-warning` deepened only at universal scope; `--tv-status-connecting` amber preserved across all 144 theme×mode blocks. |
| Completeness | 9/10 | 25% | All In-Scope items delivered (6 tokens + warning + stripe removal + DnD strip handler + bubble guard). Out-of-Scope items respected (no Sprint 254-257 work). Minor: handoff says "4 stripe assertions removed" — actually 5 were removed, but the affordance is fully gone. |
| Reliability | 8/10 | 20% | Tests model `getBoundingClientRect` via explicit per-element overrides; jsdom `stopPropagation` semantics confirmed by the AC-253-05 test passing. Three `// @ts-expect-error` for `node:fs`/`node:path`/`process` are documented inline (acceptable workaround for missing `@types/node` direct dep). One residual: `--tv-warning` is currently consumed by no-one (Tailwind alias still routes through `--tv-status-connecting`); first consumers will be Sprint 256. |
| Verification Quality | 9/10 | 20% | All 7 required checks independently re-run and pass. Token assertions use exact regex with hex value. Bubble-guard test is intentionally adversarial (cursor at midpoint where strip handler would also pick a target). DnD tests cover happy path + gap + no-drag + on-tab. |
| **Overall** | **8.85/10** | 100% | Weighted: 9×0.35 + 9×0.25 + 8×0.20 + 9×0.20 = 8.80, rounded slightly up for the universal-scope discipline (zero per-theme env-token redefinitions). Each dimension ≥ 7/10. |

## Done Criteria

- [x] **AC-253-01** — 6 env-specific tokens defined at universal `:root` scope.
  Evidence: `src/themes.css:2189-2194` (six lines, exact spec values).
  Test: `src/themes.test.ts:50-72` (one `it` per token, all values checked verbatim).
  CLI: `rg -- "--tv-env-prod|--tv-env-staging" src/themes.css` returned 6 matches.
  Spot-check for per-theme redefinitions: 0 (only the single `:root` definition).

- [x] **AC-253-02** — `--tv-warning` = `#ea580c` everywhere; `--tv-status-connecting` = `#f59e0b` preserved.
  Evidence: `src/themes.css:2184` (`--tv-warning: #ea580c;`).
  Test: `src/themes.test.ts:78-80` (deep-orange match), `:84-88` (≥72 amber matches for connecting), `:91-93` (no amber `--tv-warning` regression).
  CLI: `rg -c -- "tv-warning:" src/themes.css` = 1 (universal); `rg -c -- "tv-status-connecting:#f59e0b" src/themes.css` = 144 (every theme×mode block); `rg -- "tv-warning:#?f59e0b" src/themes.css` = 0 matches.

- [x] **AC-253-03** — Connection-color stripe IIFE deleted from `TabBar.tsx`; `getConnectionColor` import removed; library function preserved for sidebar.
  Evidence: `src/components/layout/TabBar.tsx:1-5` (imports trimmed); `git diff 362af69 -- src/components/layout/TabBar.tsx` shows the 16-line IIFE deleted between former lines 198-213; the `connections` selector also removed.
  CLI: `rg -- "getConnectionColor" src/components/layout/TabBar.tsx` = 0; `rg -- "getConnectionColor" src/` returns hits only in `src/lib/connectionColor.{ts,test.ts}` (library + sidebar use preserved).
  Test: `src/components/layout/TabBar.test.tsx:235-245` (single-conn negative assertion); `:247-260` (multi-conn negative assertion).
  Spot-check: `rg -- "inset-y-0 left-0" src/components/layout/` = 0 (no leftover stripe element).

- [x] **AC-253-04** — Strip-level `onMouseUp` resolves cursor X to nearest tab; (a) past-last → end, (b) gap → before-closer, (c) no-drag → no-op.
  Evidence: `src/components/layout/TabBar.tsx:94-128` (handler body — drag-state guard, last-tab right-edge fast path, midpoint linear scan, self-target no-op, `moveTab(src, target, side)` invocation).
  Test: `src/components/layout/TabBar.test.tsx:902-929` (a — past last), `:931-959` (b — gap before-closer), `:961-980` (c — no-drag no-op).
  Math sanity: with rects `[0..100], [100..200], [200..300]`, cursor 350 ≥ lastRect.right(300) → after t3 → `[t2, t3, t1]` ✓; cursor 210 → first midpoint ≥ 210 is 250 (t3) → before t3 → `[t2, t1, t3]` ✓; cursor far-left of first tab also works because first midpoint ≥ cursor is satisfied (defensive fallthrough at line 122 covers degenerate jsdom rect=0 case).

- [x] **AC-253-05** — Per-tab `onMouseUp` calls `e.stopPropagation()`; release on a tab triggers exactly one `moveTab`.
  Evidence: `src/components/layout/TabBar.tsx:245` (`e.stopPropagation();` after the existing per-tab `moveTab` call); `:239-244` (6-line comment explaining the bubble guard).
  Test: `src/components/layout/TabBar.test.tsx:982-1012` (release on t3 at clientX=250 — exact midpoint where strip handler would also resolve to t3 with side="before"; final order `[t2, t3, t1]` proves single-fire).
  Targeted run: `pnpm vitest run -t "AC-253-05"` = 1 passed, 42 skipped.

- [x] **AC-253-06** — Full vitest regression: 3028/3028 (Sprint 252 baseline 3017 + 11 new).
  Evidence: independent `pnpm vitest run` returned `Test Files 240 passed (240) / Tests 3028 passed (3028)`.
  Delta breakdown: `src/components/layout/TabBar.test.tsx` net +1 (5 stripe tests removed, 6 new added: 2 stripe-removal regression + 4 DnD/bubble); `src/themes.test.ts` new file +10 (1 sanity + 6 env-token + 1 warning value + 1 connecting-amber + 1 amber regression). Net +11. ✓ matches handoff.

## Verification Outputs

### 1. `pnpm tsc --noEmit`
- Exit 0 (no output) — pass.

### 2. `pnpm lint`
```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .
```
- 0 errors / 0 warnings — pass.

### 3. `pnpm vitest run`
```
Test Files  240 passed (240)
     Tests  3028 passed (3028)
   Duration  45.22s
```
- pass (matches handoff claim 3028/3028 = baseline 3017 + 11).

### 4. `cargo test --lib --manifest-path src-tauri/Cargo.toml`
```
test result: ok. 627 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 17.93s
```
- Rust untouched, regression guard pass.

### 5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
```
Finished `dev` profile [unoptimized + debuginfo] target(s)
```
- No warnings, pass.

### 6. `rg -- "--tv-env-prod|--tv-env-staging" src/themes.css`
```
  --tv-env-prod: #dc2626;
  --tv-env-prod-wash: #fef2f2;
  --tv-env-prod-text: #7f1d1d;
  --tv-env-staging: #ea580c;
  --tv-env-staging-wash: #fff7ed;
  --tv-env-staging-text: #7c2d12;
```
- 6 matches, all in the universal `:root` block — pass.

### 7. `rg -- "getConnectionColor" src/components/layout/TabBar.tsx`
- 0 matches — pass.

## Static Spot-Checks (independently verified)

### 1. `src/themes.css` token additions
- 6 env tokens at lines 2189-2194 of the universal `:root` block. Values verbatim per spec.
- `--tv-warning: #ea580c` at line 2184 of the same `:root` block. `rg -c -- "tv-warning:" src/themes.css` = 1 (single universal definition).
- `--tv-warning: #f59e0b` regressions: `rg -- "tv-warning:#?f59e0b" src/themes.css` = 0.
- `--tv-status-connecting: #f59e0b` count = 144 (both light and dark blocks for all 72 theme variants), all amber.
- **Per-theme env-token redefinitions: 0** — `rg -- "tv-env-prod|tv-env-staging" src/themes.css` returns only the 6 universal lines. Universal scope is honored.

### 2. `src/components/layout/TabBar.tsx` changes
- Lines 198-213 (former IIFE) deleted. Confirmed via `git diff 362af69 -- src/components/layout/TabBar.tsx`.
- `getConnectionColor` and `useConnectionStore` imports removed from the import block (`src/components/layout/TabBar.tsx:1-5`); `connections` selector removed.
- `scrollRef` `onMouseUp` handler at lines 94-128:
  - Drag-active gate (`if (!src?.isDragging) return;` at line 96) ✓
  - `cursorX = e.clientX` ✓
  - Nearest-tab determination via `[data-tab-id]` rects ✓
  - Last-tab-right → end (lines 110-112) ✓
  - Otherwise insert before first midpoint ≥ cursor X (lines 113-124) ✓
  - Self-move guard (line 126) ✓
  - Bubble guard: per-tab `onMouseUp` at line 245 calls `e.stopPropagation()` ✓.

### 3. `src/components/layout/TabBar.test.tsx` changes
- 5 connection-color assertions (former lines 229, 242, 256, 267, 361 in baseline) **removed**.
- 2 NEW negative-assertion regression tests at `:235-245` and `:247-260`.
- 4 NEW DnD test cases at `:902-929`, `:931-959`, `:961-980`, `:982-1012`.
- `mockTabRects` helper at `:881-900` (per-element `getBoundingClientRect` mock).

### 4. NEW `src/themes.test.ts`
- 10 test cases (1 sanity + 6 env-token + 1 warning value + 1 connecting-amber + 1 warning-amber regression).
- Reads CSS via `node:fs.readFileSync` (Vite 6 `?raw` workaround documented inline at lines 16-22).
- 3 `// @ts-expect-error` directives — all annotated with rationale (`@types/node` not declared as a direct dep). **No `// @ts-ignore`** present. ✓

## Anti-pattern Audit

| Pattern | Status |
|---|---|
| Tests pass claimed without re-run | NOT PRESENT — all 7 checks independently re-run by evaluator |
| Tokens redefined per-theme | NOT PRESENT — `rg` confirms env tokens defined once in universal `:root` |
| `--tv-status-connecting` accidentally changed | NOT PRESENT — 144 amber matches preserved |
| `getConnectionColor` library function modified | NOT PRESENT — `src/lib/connectionColor.ts` unchanged; only TabBar import removed |
| Empty-area DnD edge case missed (cursor far-left) | NOT PRESENT — defensive fallthrough at line 122 + first-midpoint-≥-cursor logic correctly inserts before first tab |
| Bubble guard incorrect (double-fire) | NOT PRESENT — adversarial test at `:982-1012` proves single-fire |
| Stripe removal incomplete (empty `inset-y-0` leftover) | NOT PRESENT — `rg -- "inset-y-0 left-0" src/components/layout/` = 0 |
| `// @ts-ignore` instead of `// @ts-expect-error` | NOT PRESENT — only 3 documented `@ts-expect-error` |

## Out-of-Scope Working-Tree Changes

- `src/components/schema/CreateTableDialog.test.tsx` shows up in `git diff 362af69 -- src/`. **Verified to be from commit `018455a` (Sprint 229 fix), not Sprint 253.** Generator's working tree only modifies the 3 in-scope files + adds `src/themes.test.ts`. ✓

## Feedback for Generator

Even though this is a clean PASS, two minor polish notes:

1. **Handoff inaccuracy (cosmetic)**: The handoff says "4 stripe assertions removed" — actually 5 were removed (baseline lines 229, 242, 256, 267, 361 in `TabBar.test.tsx`). The arithmetic still works out (net +1 in TabBar.test.tsx + 10 in themes.test.ts = +11 vs 3017 baseline = 3028) but the line is off by one.

2. **`--tv-warning` is currently a "dangling" token**: The Tailwind alias `--color-warning` still routes through `--tv-status-connecting` (amber), so the new deep-orange `--tv-warning` value has zero current consumers. This is correct per contract ("src/index.css alias unchanged") and per spec phasing (Sprint 256 will be first consumer). Suggest a brief inline comment in `src/themes.css` near the `--tv-warning: #ea580c;` line noting the *intended* consumer (Chrome H + Button F) so a future sprint doesn't accidentally repurpose the token. The existing comment already covers the semantic split (amber=connecting vs orange=warning/staging) but doesn't name the future consumer.

3. **`mockTabRects` could move to a shared test util**: Two existing reorder tests (`:387-405`, `:407-421`) already use `fireEvent.mouseEnter` for nearest-tab determination, while the new DnD tests use explicit `getBoundingClientRect` mocks. Future Sprint 256 work that touches DnD will likely need the same helper — consider promoting `mockTabRects` to `src/test/utils/dom.ts` (or whichever the project's shared-test-util location is).

4. **Defensive last-tab fallthrough comment**: Lines 115-117 say the fallthrough "shouldn't happen because we already handled 'past last tab' above". With jsdom's default 0/0/0/0 rect (when `mockTabRects` isn't called), every tab's midpoint is 0, so a cursor at any X > 0 would skip every tab and trigger the fallthrough. The DnD tests always call `mockTabRects` so this is benign, but a one-liner like "guards against degenerate-rect environments (jsdom default)" would future-proof the comment.

None of these block the sprint. They are polish for the chained Sprint 256 work.

## Generator Feedback Summary

- /tdd flow evidence accepted: `11 failed | 41 passed (52)` red-phase intermediate run cited in handoff is consistent with the final 52 passed when production code landed.
- Exit Criteria all met: 0 P1/P2 findings, all 7 required checks passing, AC evidence linked, /tdd cited, prior invariants preserved.
- Sprint 250-252 invariants preserved (DataGrid pending edits / Cmd+Z undo / Preview SQL Copy button — all confirmed via full vitest 3028 pass).

---

```yaml
# Structured scorecard block
sprint: 253
verdict: PASS
overall_score: 8.85
dimensions:
  correctness: 9
  completeness: 9
  reliability: 8
  verification_quality: 9
done_criteria:
  AC-253-01: pass
  AC-253-02: pass
  AC-253-03: pass
  AC-253-04: pass
  AC-253-05: pass
  AC-253-06: pass
required_checks:
  pnpm_tsc_no_emit: pass
  pnpm_lint: pass
  pnpm_vitest_run: pass
  cargo_test_lib: pass
  cargo_clippy_all: pass
  rg_env_tokens: pass (6 matches)
  rg_get_connection_color_tabbar: pass (0 matches)
p1_findings: 0
p2_findings: 0
follow_up_polish: 4
test_count_delta: +11 (3017 -> 3028)
```
