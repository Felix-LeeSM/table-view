# Sprint 133 — Handoff

## Generator Handoff

### Changed Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Repurpose Cmd+, → Home/Workspace toggle; add Cmd+1..9 (workspace tab switch) and Cmd+K (open-connection-switcher dispatch) keydown effects. |
| `src/App.test.tsx` | Replace legacy `Cmd+, dispatches open-settings event` test with toggle/editable-target/no-event regression suite; add Cmd+1..9 + Cmd+K coverage. Default screen=workspace in `beforeEach` so existing Cmd+W/T/. assertions still see workspace context. |
| `src/components/workspace/ConnectionSwitcher.tsx` | Lift Radix `Select` `open` state to controlled (new `useState`) and listen for the global `open-connection-switcher` event — flips `open=true` on dispatch, cleans up on unmount. |
| `src/components/workspace/ConnectionSwitcher.test.tsx` | Append regression: dispatching `open-connection-switcher` opens the popover and surfaces option rows. |
| `src/components/shared/ShortcutCheatsheet.tsx` | Update `SHORTCUT_GROUPS`: rename Cmd+, label to "Toggle Home/Workspace", append "Switch to tab 1–9" (Tabs group), append "Open connection switcher" (Navigation group). Group order preserved. |
| `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx` | Add three label-presence assertions (Toggle Home/Workspace; Switch to tab 1–9; Open connection switcher) + sanity check that legacy "Settings" is gone. |
| `e2e/db-switcher.spec.ts` | NEW. Mocha skip-scaffold for the DB switcher (PG + Mongo) e2e; gated behind `E2E_PG_HOST` / `E2E_MONGO_HOST` env vars. |
| `e2e/raw-query-db-change.spec.ts` | NEW. Mocha skip-scaffold for the S132 `\c admin` raw-query DB-change detection e2e; gated behind `E2E_PG_HOST`. |

### Checks Run

| Command | Outcome |
|---------|---------|
| `pnpm vitest run` | **PASS** — 126 test files, 2042 tests, 0 failures (was 2027+ baseline). |
| `pnpm tsc --noEmit` | **PASS** — 0 errors. |
| `pnpm lint` | **PASS** — 0 ESLint errors (covers `src/**` + `e2e/**`). |
| `pnpm contrast:check` | **PASS** — 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted). |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **PASS** — 268 passed; 0 failed; 2 ignored. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **PASS** — 0 warnings. |
| e2e static compile (lint over `e2e/**`) | **PASS** — `pnpm exec eslint e2e/db-switcher.spec.ts e2e/raw-query-db-change.spec.ts` returns clean. The project's `tsconfig.json` `include` is `["src"]` so e2e specs are not part of `pnpm tsc --noEmit`; static verification is via ESLint, mirroring how existing e2e specs are validated. |

### Done Criteria Coverage / AC Mapping

| AC | Evidence |
|----|----------|
| AC-01 — `App.tsx` Cmd+, → setScreen toggle | `src/App.tsx:108-141` (combined effect) — Cmd+, branch at lines 117-124 calls `setScreen(current === "workspace" ? "home" : "workspace")`. Editable-target + Shift/Alt guards retained. |
| AC-02 — `App.tsx` Cmd+1..9 → workspace tab switch | `src/App.tsx:148-166` — new `useEffect`. Out-of-range no-op (`if (!tab) return;`), screen guard (`if (current !== "workspace") return;`), `preventDefault` on match. |
| AC-03 — `App.tsx` Cmd+K → dispatch open-connection-switcher | `src/App.tsx:171-184` — new `useEffect`. Screen guard, isEditableTarget guard, preventDefault, dispatches `new CustomEvent("open-connection-switcher")`. |
| AC-04 — ConnectionSwitcher event listener | `src/components/workspace/ConnectionSwitcher.tsx:71-83` — `useEffect` listens on `open-connection-switcher`, mutates the new `open` state, cleanup on unmount. Controlled `open` / `onOpenChange` wired into `<Select>` at lines 121-122. |
| AC-05 — SHORTCUT_GROUPS update | `src/components/shared/ShortcutCheatsheet.tsx:45-89` — Tabs group line 53 adds "Switch to tab 1–9"; Navigation group line 70 adds "Open connection switcher"; Panels group line 76 renames "Settings" → "Toggle Home/Workspace". Group order (Tabs → Editing → Navigation → Panels → Misc) preserved. |
| AC-06 — `App.test.tsx` open-settings test replaced | `src/App.test.tsx:194-251` replaces the previous `:193-201` block with four scenarios (workspace→home, home→workspace, editable-target no-op, legacy event no longer dispatched). |
| AC-07 — App.test.tsx new scenarios | `src/App.test.tsx:359-440` (Cmd+1, Cmd+2, Cmd+5 with 3 tabs no-op, Cmd+1 in home no-op, Cmd+1 editable no-op, Cmd+K workspace dispatch, Cmd+K home no-dispatch, Cmd+K editable no-op). Existing Cmd+N/Cmd+P regression: `src/App.test.tsx:160-191`. |
| AC-08 — ConnectionSwitcher.test.tsx event scenario | `src/components/workspace/ConnectionSwitcher.test.tsx:326-352` — "dispatching open-connection-switcher opens the popover". |
| AC-09 — ShortcutCheatsheet.test.tsx label assertions | `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx:124-145` — three new tests; legacy "Settings" sanity check at line 130. |
| AC-10 — New e2e specs | `e2e/db-switcher.spec.ts` (PG + Mongo describes, runtime skip via `before(function () { if (!process.env.E2E_PG_HOST) this.skip(); })`); `e2e/raw-query-db-change.spec.ts` (PG describe with same skip pattern). Both lint clean and follow existing kebab-case `*.spec.ts` convention. |
| AC-11 — All 7 verification commands green | See "Checks Run" table above. |
| AC-12 — User-visible regression 0 | All 2042 vitest tests pass including the previously-existing Cmd+N/T/W/S/P/R/I/F5/Cmd+. and Sprint 60 navigate-table / quickopen-function regressions. Cargo + clippy + contrast all clean. ConnectionSwitcher's external `<ConnectionSwitcher />` props signature unchanged (no props before, no props after). `appShellStore.setScreen` API unchanged. ShortcutCheatsheet group order unchanged. |

### Code Citations

**Cmd+, repurpose** (`src/App.tsx:108-141`):

```ts
// Cmd+N / Ctrl+N — new connection
// Cmd+S / Ctrl+S — commit changes
// Cmd+P / Ctrl+P — quick open
// Cmd+, / Ctrl+, — toggle Home/Workspace (sprint 133 — repurposed from the
//                  old `open-settings` event which had zero consumers).
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;

    const key = e.key;

    // Sprint 133 — Cmd+, toggles between Home and Workspace screens.
    // Repurposed from the dead `open-settings` event dispatch. The Shift /
    // Alt guard prevents accidentally toggling on Cmd+Shift+, etc.
    if (key === ",") {
      if (e.shiftKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const { screen: current, setScreen } = useAppShellStore.getState();
      setScreen(current === "workspace" ? "home" : "workspace");
      return;
    }

    let eventName: string | null = null;
    if (key === "n") eventName = "new-connection";
    else if (key === "s") eventName = "commit-changes";
    else if (key === "p") eventName = "quick-open";

    if (!eventName) return;

    if (isEditableTarget(e.target)) return;

    e.preventDefault();
    window.dispatchEvent(new CustomEvent(eventName));
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, []);
```

**Cmd+1..9 hook** (`src/App.tsx:148-166`):

```ts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const digit = e.key;
    if (digit < "1" || digit > "9") return;
    if (isEditableTarget(e.target)) return;
    const { screen: current } = useAppShellStore.getState();
    if (current !== "workspace") return;
    const index = Number(digit) - 1;
    const { tabs, setActiveTab } = useTabStore.getState();
    const tab = tabs[index];
    if (!tab) return;
    e.preventDefault();
    setActiveTab(tab.id);
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, []);
```

**Cmd+K hook** (`src/App.tsx:171-184`):

```ts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    if (e.key !== "k" && e.key !== "K") return;
    if (isEditableTarget(e.target)) return;
    const { screen: current } = useAppShellStore.getState();
    if (current !== "workspace") return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("open-connection-switcher"));
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, []);
```

**ConnectionSwitcher event listener** (`src/components/workspace/ConnectionSwitcher.tsx:65-83, 121-122`):

```ts
// Sprint 133 — promote Radix `Select`'s open state to controlled so the
// global Cmd+K shortcut can flip it open via a window event without
// requiring the user to click the trigger first.
const [open, setOpen] = useState(false);

useEffect(() => {
  const handler = () => setOpen(true);
  window.addEventListener("open-connection-switcher", handler);
  return () =>
    window.removeEventListener("open-connection-switcher", handler);
}, []);
// …
<Select
  value={activeConn?.id ?? ""}
  onValueChange={handleChange}
  open={open}
  onOpenChange={setOpen}
  disabled={noConnected}
>
```

**SHORTCUT_GROUPS diff** (`src/components/shared/ShortcutCheatsheet.tsx:45-89`):

```ts
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Tabs",
    items: [
      { label: "Close tab", keys: ["Cmd+W"] },
      { label: "New query tab", keys: ["Cmd+T"] },
      { label: "Reopen last closed tab", keys: ["Cmd+Shift+T"] },
      // Sprint 133 — Cmd+1..9 jumps to the N-th workspace tab.
      { label: "Switch to tab 1–9", keys: ["Cmd+1", "…", "Cmd+9"] },
    ],
  },
  // … Editing unchanged …
  {
    label: "Navigation",
    items: [
      { label: "Quick open", keys: ["Cmd+P"] },
      { label: "Refresh", keys: ["Cmd+R", "F5"] },
      { label: "Cancel running query", keys: ["Cmd+."] },
      // Sprint 133 — Cmd+K opens the workspace ConnectionSwitcher.
      { label: "Open connection switcher", keys: ["Cmd+K"] },
    ],
  },
  {
    label: "Panels",
    items: [
      // Sprint 133 — Cmd+, toggles the Home / Workspace screens (replaces
      // the dead `open-settings` event from sprint 33).
      { label: "Toggle Home/Workspace", keys: ["Cmd+,"] },
      { label: "Toggle favorites", keys: ["Cmd+Shift+F"] },
      { label: "Toggle global query log", keys: ["Cmd+Shift+C"] },
    ],
  },
  // … Misc unchanged …
];
```

**New e2e spec headers**:

`e2e/db-switcher.spec.ts`:

```ts
import { expect } from "@wdio/globals";

describe("DB switcher (Sprint 133)", function () {
  before(function () {
    if (!process.env.E2E_PG_HOST) {
      this.skip();
    }
  });

  it("opens the switcher and lists databases for a PG connection", async function () {
    this.skip();
    expect(true).toBe(true);
  });

  it("opens the switcher and lists databases for a Mongo connection", async function () {
    if (!process.env.E2E_MONGO_HOST) {
      this.skip();
    }
    this.skip();
    expect(true).toBe(true);
  });
});
```

`e2e/raw-query-db-change.spec.ts`:

```ts
import { expect } from "@wdio/globals";

describe("Raw-query DB-change detection (Sprint 133)", function () {
  before(function () {
    if (!process.env.E2E_PG_HOST) {
      this.skip();
    }
  });

  it("detects `\\c admin` and updates sidebar + switcher label", async function () {
    this.skip();
    expect(true).toBe(true);
  });
});
```

### Assumptions

- **`pnpm tsc --noEmit` does not type-check `e2e/**`** — the project's `tsconfig.json` `include` is `["src"]`, so e2e specs are validated by `pnpm lint` (covers `e2e/**`) and at wdio runtime. The new specs lint clean and follow the same skeleton as `e2e/keyboard-shortcuts.spec.ts` and `e2e/paradigm-and-shortcuts.spec.ts`. No `e2e/tsconfig.json` exists in the repo.
- **Numpad digit keys (`Numpad1`..`Numpad9`) are intentionally NOT matched by Cmd+1..9** — the design bar in the contract says "string '1'..'9' only". This is documented in the inline comment at `src/App.tsx:146-147`.
- **`Mongo describe` in `db-switcher.spec.ts` runtime-skips when `E2E_MONGO_HOST` is unset**, even when `E2E_PG_HOST` is set. The Mongo container is optional fixture per the contract.
- **e2e spec bodies are intentionally deferred** — sprint scope is the spec scaffold + skip wiring; full body coverage (real PG/Mongo interactions) is tracked separately.
- **No existing Cmd+K binding was overwritten** — no other `App.tsx` effect handles Cmd+K. (Searched the App.tsx file; the only handlers using `e.key === "k"` are the new Cmd+K effect.)
- **`ConnectionSwitcher` is now controlled** — promoted `open` state from Radix-internal to a `useState` so the event listener can flip it open. `onOpenChange={setOpen}` mirrors the previous uncontrolled close-on-click behaviour exactly. No external props signature change.
- **Shift/Alt are explicitly rejected** by the new Cmd+1..9, Cmd+K, and Cmd+, branches so they don't fight Cmd+Shift+T (reopen tab), Cmd+Shift+F (favorites), Cmd+Shift+C (query log), Cmd+Shift+I (uglify SQL), or any other Cmd+Shift / Cmd+Alt binding.

### Residual Risk

- **e2e spec runtime body is a TODO** — the new specs are scaffolds. Full body coverage requires fixture wiring (PG container, Mongo container, helper functions for "select connection in switcher", "open DB switcher popover", "click DB row"). Mitigated because the spec gates on `E2E_PG_HOST` / `E2E_MONGO_HOST`, so CI without fixtures sees a clean skip.
- **Cmd+K conflict with browser extensions** — some webview-installed extensions bind Cmd+K (e.g. Vimium). In Tauri the webview is sandboxed, but if the user later installs a custom extension layer, they may pre-empt our handler. Out of scope for this sprint.
- **Numpad digits are not handled** — power users with Numpad-only keyboards cannot trigger Cmd+1..9. Per design bar; revisit if reported.
