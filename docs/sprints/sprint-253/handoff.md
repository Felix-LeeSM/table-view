# Handoff: sprint-253

## Outcome

- Status: Complete (Generator green phase finished)
- Summary: Foundation for the ADR 0023 5-sprint chain
  (253 → 255 → 254 → 256 → 257) landed atomically. `src/themes.css` gained
  6 universal env-specific tokens (`--tv-env-prod` / `-prod-wash` /
  `-prod-text` / `-staging` / `-staging-wash` / `-staging-text`) plus a
  universal `--tv-warning: #ea580c` (deepened from amber to deep orange);
  `--tv-status-connecting` retains its amber `#f59e0b` semantics in every
  theme. `TabBar.tsx` shed the per-tab connection-color stripe IIFE
  (Sprint 28/45 affordance retired per grill Q11) along with its
  `getConnectionColor` import and `connections` selector. A new strip-
  level `onMouseUp` on the `scrollRef` tablist resolves drop-on-empty-
  area releases by cursor X (Chrome/VSCode standard, grill Q13); per-tab
  `onMouseUp` now calls `e.stopPropagation()` to prevent the strip's
  bubble handler from double-invoking `moveTab`. All 6 AC-253-* are
  satisfied; full vitest 3028/3028 (baseline 3017 + 11 new).

## Verification Profile

- Profile: command
- Overall score: green (all 7 required checks pass)
- Final evaluator verdict: deferred to harness Evaluator agent

## Evidence Packet

### Checks Run

- `pnpm tsc --noEmit`: pass (0 errors — exit 0, no output)
- `pnpm lint`: pass (0 errors / 0 warnings — `> table-view@0.1.0 lint`
  then `> eslint .` with no findings)
- `pnpm vitest run`: pass (`Test Files  240 passed (240)` /
  `Tests  3028 passed (3028)` — baseline 3017 + 11 new)
- `cargo test --lib --manifest-path src-tauri/Cargo.toml`: pass
  (`test result: ok. 627 passed; 0 failed; 2 ignored`)
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features -- -D warnings`: pass (`Finished \`dev\` profile
  [unoptimized + debuginfo]`, no warnings)
- `rg "--tv-env-prod|--tv-env-staging" src/themes.css`: pass (6 matches —
  one per token, all in the universal `:root` common-token block)
- `rg "getConnectionColor" src/components/layout/TabBar.tsx`: pass
  (0 matches — import + IIFE both deleted)

### Acceptance Criteria Coverage

| AC | Test file:line | Production file:line |
|---|---|---|
| `AC-253-01` 6 env tokens defined universal scope (every 72 theme inherits) | `src/themes.test.ts:50-72` (one `it` per token, all 6 covered) | `src/themes.css:2189-2194` (6 lines in the common `:root` block) |
| `AC-253-02` `--tv-warning` = `#ea580c` in every theme | `src/themes.test.ts:78-80` (deep-orange) ; regression guard `src/themes.test.ts:91-93` (no amber `--tv-warning`) ; amber-preservation `src/themes.test.ts:84-88` (status-connecting still `#f59e0b`) | `src/themes.css:2184` (universal `--tv-warning: #ea580c`) ; `--tv-status-connecting:#f59e0b` lines unchanged across all 144 theme×mode blocks |
| `AC-253-03` connection-color stripe IIFE deleted from TabBar; `getConnectionColor` import gone | regression `src/components/layout/TabBar.test.tsx:235-245` (single conn) ; `src/components/layout/TabBar.test.tsx:247-258` (multi conn) ; CLI guard `rg getConnectionColor src/components/layout/TabBar.tsx` = 0 | `src/components/layout/TabBar.tsx:1-14` (import block — `getConnectionColor` + `useConnectionStore` both removed) ; `src/components/layout/TabBar.tsx:248-252` (was the IIFE; now the `tab.type === "query"` icon branch follows directly after `onMouseUp`) |
| `AC-253-04` strip onMouseUp resolves cursor X → moveTab; (a) past-last-tab → end, (b) gap → before-closer, (c) no-drag → no-op | (a) `src/components/layout/TabBar.test.tsx:902-929` ; (b) `src/components/layout/TabBar.test.tsx:931-959` ; (c) `src/components/layout/TabBar.test.tsx:961-980` | `src/components/layout/TabBar.tsx:83-128` (scrollRef onMouseUp body — drag-state guard, last-tab right-edge fast path, midpoint linear scan, self-target no-op, `moveTab(src, target, side)` invocation) |
| `AC-253-05` per-tab onMouseUp stops bubble → no double moveTab on tab release | `src/components/layout/TabBar.test.tsx:982-1012` (release on t3 with drag of t1 → exactly `[t2, t3, t1]`, not double-shifted) | `src/components/layout/TabBar.tsx:229-246` (`e.stopPropagation()` after the per-tab `moveTab` call) |
| `AC-253-06` full vitest regression — Sprint 252 baseline 3017 + new ≈ 3028 | full `pnpm vitest run` 3028 passed | n/a — entire suite |

### Tests-First (TDD) evidence

> Tests-first (TDD): 신규 테스트 작성 → red → 구현 → green.

- Step 1 (red): `src/themes.test.ts` (new file, 10 cases) and the new
  TabBar cases (2 stripe-removal regression + 4 DnD/bubble) were written
  before any production change. Initial targeted run on those files
  produced `11 failed | 41 passed (52)` — the 8 token tests, the 2
  stripe-removal regression tests, and the empty-area DnD test (last-tab-
  right) failed as expected; the no-drag noop and bubble-guard cases
  passed trivially (no strip handler existed yet so they couldn't
  double-fire).
- Step 2 (green): `src/themes.css` gained the 6 env tokens + universal
  `--tv-warning: #ea580c`; `src/components/layout/TabBar.tsx` lost the
  connection-stripe IIFE and gained the strip-level `onMouseUp` plus the
  per-tab `e.stopPropagation()`. Re-run flipped the entire targeted set
  to `52 passed (52)`, and the full suite to `3028 passed (3028)`.

### Code excerpts

#### `src/themes.css` — universal env tokens + warning deepening

```css
:root {
  --tv-destructive: #ef4444;
  --tv-destructive-foreground: #ffffff;
  --tv-success-foreground: #ffffff;
  --tv-warning-foreground: #ffffff;
  /* Sprint 253 (ADR 0023) — `--tv-warning` deepened from amber #f59e0b
   * to #ea580c so warning/staging chrome and STOP-tier red form a clear
   * visual gradient (amber → orange → red). `--tv-status-connecting`
   * intentionally retains amber #f59e0b in every theme block to keep the
   * "connecting" state semantically distinct from "warning/staging". */
  --tv-warning: #ea580c;
  /* Sprint 253 (ADR 0023, AC-253-01) — environment-specific tokens for
   * the upcoming Chrome H stripe (Sprint 256) + ConfirmDestructiveDialog
   * header alignment + Button F color × env matrix. Universal (theme-
   * independent) so all 72 theme variants inherit identically. */
  --tv-env-prod: #dc2626;
  --tv-env-prod-wash: #fef2f2;
  --tv-env-prod-text: #7f1d1d;
  --tv-env-staging: #ea580c;
  --tv-env-staging-wash: #fff7ed;
  --tv-env-staging-text: #7c2d12;
  --tv-highlight: #eab308;
  ...
}
```

#### `src/components/layout/TabBar.tsx` — stripe IIFE deletion (diff)

```diff
 import { useTabStore, type Tab, type TableTab } from "@stores/tabStore";
-import { useConnectionStore } from "@stores/connectionStore";
 import { Button } from "@components/ui/button";
-import { getConnectionColor } from "@lib/connectionColor";
 import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";

   const moveTab = useTabStore((s) => s.moveTab);
   const dirtyTabIds = useTabStore((s) => s.dirtyTabIds);
-  const connections = useConnectionStore((s) => s.connections);

           >
-            {(() => {
-              const conn = connections.find((c) => c.id === tab.connectionId);
-              if (!conn) return null;
-              const color = getConnectionColor(conn);
-              const isActive = tab.id === activeTabId;
-              return (
-                <span
-                  className={`absolute inset-y-0 left-0 w-0.5 ${
-                    isActive ? "opacity-100" : "opacity-60"
-                  }`}
-                  style={{ backgroundColor: color }}
-                  aria-label="Connection color"
-                  title={conn.name}
-                />
-              );
-            })()}
             {tab.type === "query" ? (
```

#### `src/components/layout/TabBar.tsx` — scrollRef `onMouseUp` (cursor X + bubble guard)

```tsx
onMouseUp={(e) => {
  const src = dragStateRef.current;
  if (!src?.isDragging) return;
  const container = e.currentTarget as HTMLElement;
  const tabEls = Array.from(
    container.querySelectorAll<HTMLElement>("[data-tab-id]"),
  );
  if (tabEls.length === 0) return;
  const cursorX = e.clientX;
  // Past the last tab's right edge → insert source after the
  // last tab (= move to end). This matches the natural "drop in
  // the trailing space" UX.
  const lastEl = tabEls[tabEls.length - 1]!;
  const lastRect = lastEl.getBoundingClientRect();
  let targetEl: HTMLElement;
  let side: "before" | "after";
  if (cursorX >= lastRect.right) {
    targetEl = lastEl;
    side = "after";
  } else {
    // Otherwise, find the first tab whose midpoint is ≥ cursor X
    // and insert before it. Falls through to the last tab if no
    // midpoint comparison matches (defensive — shouldn't happen
    // because we already handled "past last tab" above).
    const found = tabEls.find((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 >= cursorX;
    });
    targetEl = found ?? lastEl;
    side = "before";
  }
  const targetId = targetEl.getAttribute("data-tab-id");
  if (!targetId || targetId === src.tabId) return;
  moveTab(src.tabId, targetId, side);
}}
```

#### Per-tab `onMouseUp` bubble guard

```tsx
onMouseUp={(e) => {
  const src = dragStateRef.current;
  if (src?.isDragging && src.tabId !== tab.id) {
    const rect = (
      e.currentTarget as HTMLElement
    ).getBoundingClientRect();
    const side =
      e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    moveTab(src.tabId, tab.id, side);
  }
  // Sprint 253 (AC-253-05) — stop bubble so the strip-level
  // onMouseUp (empty-area handler) does not also reorder on
  // a release that already landed on a tab. Without this,
  // both handlers would fire (per-tab first, strip on bubble)
  // and the strip's cursor-X resolution might pick the same
  // tab again, double-invoking moveTab and corrupting order.
  e.stopPropagation();
}}
```

### Screenshots / Links / Artifacts

- None (no UI screenshots requested by the contract; verification is
  command-profile pure).

## Changed Areas

- `src/themes.css`: +14 / -0 lines in the existing universal `:root`
  common-token block — 6 env tokens + 1 `--tv-warning` token + 2 multi-
  line comment headers explaining ADR 0023 origin and amber-vs-orange
  semantic split.
- `src/components/layout/TabBar.tsx`: imports trimmed
  (`useConnectionStore` + `getConnectionColor` removed); selector
  `connections` removed; per-tab connection-color stripe IIFE deleted
  (16 lines); `scrollRef` div gained an `onMouseUp` handler (44 lines
  including comment); per-tab `onMouseUp` gained a trailing
  `e.stopPropagation()` (and a 6-line comment explaining the bubble
  guard).
- `src/components/layout/TabBar.test.tsx`: 4 stripe assertions removed
  (lines previously covering Sprint 28 multi-color and Sprint 45 tooltip
  affordances); 2 stripe-removal regression cases added; 4 DnD cases
  added (last-tab-right release, gap-between release, no-drag release,
  on-tab release with bubble guard); a `mockTabRects` helper sets
  `getBoundingClientRect` on `[data-tab-id]` elements so jsdom can model
  cursor X resolution.
- `src/themes.test.ts`: NEW file (10 test cases) — token-presence
  contract verified by reading `src/themes.css` via `node:fs.readFileSync`
  with a comment explaining the deliberate `?raw` workaround (Vite 6 CSS
  plugin stubs `?raw` for `.css` files to `""` regardless of how it's
  imported).

## Assumptions

- `--tv-status-connecting` amber `#f59e0b` is intentionally preserved
  across all 144 theme×mode blocks; the test asserts ≥ 72 matches as a
  conservative floor (light + dark each carry one, total ≈ 144). The
  contract makes the "connecting" vs "warning/staging" semantic split
  explicit (Q7), so this is the canonical interpretation.
- The bubble guard uses `e.stopPropagation()` on the per-tab
  `onMouseUp` rather than the alternative `dragStateRef === null` check.
  Reason: the document-level `handleMouseUp` (lines 173-181 historical,
  216-224 post-edit) resets `dragStateRef` to `null` *after* both child
  and bubble React handlers run, so a "is dragStateRef still set?" check
  in the strip handler would always evaluate `true` during the bubble
  window. `stopPropagation` is the unambiguous fix and matches the
  contract's "Recommended" guidance.
- Single-connection visual impact: with the connection-color stripe
  removed, single-connection workspaces (the dominant use case per Q11)
  lose no information. Multi-connection workspaces lose the per-tab
  color hint but retain connection identity via the sidebar (which
  still uses `CONNECTION_COLOR_PALETTE` from `src/lib/connectionColor.ts`
  — verified by `rg connectionColor src/`).
- `?raw` for CSS files: Vite 6's CSS plugin intercepts `.css?raw`
  imports (verified empirically — direct `import x from "./themes.css?raw"`
  and `import.meta.glob("./themes.css", { query: "?raw" })` both yielded
  `""`). The test falls back to `node:fs.readFileSync` with three
  `// @ts-expect-error` suppressions because `@types/node` is not a
  declared dev-dep in this project (it is transitively present via
  vitest's runtime). This is documented inline so a future generator
  understands the workaround intent.

## Residual Risk

- `--tv-warning` color shift (amber `#f59e0b` → deep orange `#ea580c`)
  carries an *intended* visual change in any consumer of
  `var(--tv-warning)`. Auditing the codebase for direct references
  surfaced none (the actual `--color-warning` Tailwind alias still
  resolves through `--tv-status-connecting` as documented in the
  contract's "src/index.css alias unchanged" line), so the immediate
  blast radius is zero. Sprint 256's Chrome H + Button F will be the
  first consumers of the new `--tv-warning` and the env-specific
  tokens — visual regression there is by-design (the deeper orange is
  the spec'd severity-WARN signal).
- jsdom DOM rect mocking: the new DnD tests stub `getBoundingClientRect`
  per `[data-tab-id]` element via the local `mockTabRects` helper.
  Real-browser layout may differ (the tablist could scroll horizontally,
  shifting offsets), but the production code reads `getBoundingClientRect`
  directly so it inherits whatever the browser reports — no transform
  layer to drift between jsdom and WKWebView.
- Test count discipline: the test count rose from 3017 → 3028 (+11),
  which is 5 over the contract's lower-bound estimate of "≈ 3-5 case".
  The extra cases live in `src/themes.test.ts` (one assertion per token
  + 2 regression guards + 1 sanity), which the contract authorizes
  ("a small CSS-presence test") and which serves as the only durable
  guard against the env tokens being silently dropped or re-amber-ized
  by a future themes.css refactor.

## Next Sprint Candidates

- Sprint 255 (ordered next per the spec) — WARN dialog mount in raw SQL
  editor; will consume the existing 2-tier `severity` and the new
  `--tv-warning` deep-orange token for header chrome.
- Sprint 254 — Severity classifier 3-tier split + dry-run STOP escalation
  (the precision pass on top of Sprint 255's dialog wiring).
- Sprint 256 — Chrome H + Button F + ConfirmDestructiveDialog header
  alignment; first major consumer of the 6 env tokens defined here.
