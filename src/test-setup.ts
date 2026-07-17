// Issue #1307 — the app entry installs this globally; vitest does not run
// `main.tsx`, so mirror the patch here or component tests rendering BigInt
// cells would hit react-dom's stringify throw.
import "@lib/bigintJson";
import "@testing-library/jest-dom/vitest";
// i18n 전역 인스턴스를 테스트 프로세스 시작 시 1회 init — useTranslation 을
// 쓰는 컴포넌트(ThemePicker / LanguageSwitcher 등)가 provider 없이도 동작.
import "@lib/i18n";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { useToastStore } from "@stores/toastStore";
import { resetTauriMock } from "./test-utils/tauriMock";

vi.mock("@lib/tauri", async () => {
  const { getTauriMockModule } = await import("./test-utils/tauriMock");
  return getTauriMockModule();
});
vi.mock("@/lib/tauri", async () => {
  const { getTauriMockModule } = await import("./test-utils/tauriMock");
  return getTauriMockModule();
});

// #1580 — `persistWorkspace` is the workspace persist IPC boundary, called by
// the debounced background write that every workspace mutation schedules. It
// lives in the `@lib/tauri/workspaces` submodule (not the `@lib/tauri` barrel
// mocked above), so component/store specs that seed a workspace hit the REAL
// `@tauri-apps/api/core` invoke, which rejects in jsdom and queues a stray
// `storageWriteFailed` toast — flaking sibling toast-length assertions under
// parallel-suite load. Mock the boundary to a no-op resolve, matching the
// tauriMock philosophy. The two specs that assert the real IPC wiring
// (`persistence.ipc` / `persistence.flush`) `vi.unmock` it and drive their own
// `@tauri-apps/api/core` mock. `persistence.ts` is the only importer, and no
// spec spies on `persistWorkspace`, so the blast radius is the persist path.
vi.mock("@lib/tauri/workspaces", () => ({
  persistWorkspace: vi.fn(() => Promise.resolve()),
}));

// Sprint 401 (2026-05-17) — eager WASM bootstrap for the mongosh parser.
// `parseMongoshStatement` 의 *모든* 호출부 (Toolbar render, useQueryExecution
// dispatch, runCommandParser classify) 가 sync 시그니처를 기대하므로,
// vitest 전체 프로세스 시작 시점에 WASM 모듈을 1회 instantiate 해서 facade
// 의 `wasmModule` 슬롯을 채워둔다. jsdom 에는 `fetch()` 도 없으므로
// wasm-pack 의 default `__wbg_init` 가 fetch fallback 으로 떨어진다 —
// `initMongoshWasm(bytes)` overload 로 Node `fs.readFileSync` 결과를 직접
// 전달해 `initSync` 코드패스를 탄다.
beforeAll(async () => {
  const { initMongoshWasm } = await import("@features/query");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { resolve, dirname } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const wasmPath = resolve(
    here,
    "lib",
    "mongo",
    "wasm",
    "mongosh_parser_core_bg.wasm",
  );
  // Slice the Buffer to a fresh ArrayBuffer so `new WebAssembly.Module(...)`
  // sees a BufferSource it accepts (Node Buffer extends Uint8Array but
  // some bundler glue does an instanceof check that fails on Buffer).
  const buf = readFileSync(wasmPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await initMongoshWasm(ab);
});

// sprint-366 (2026-05-16, Phase 4 Q15) — workspace tree components read
// their connection identity from `useCurrentWindowConnectionId()` which
// delegates to `getCurrentWindowLabel()`. The real implementation calls
// `getCurrentWebviewWindow()` and returns `null` outside Tauri (which
// would already be safe in jsdom), but tests that need to drive a
// *specific* connection id via the label must override the mock per
// test. Hoist the mock to setup so every test file gets a `vi.fn()`
// that can be re-pointed by `setFakeWindowConnectionId()` without
// per-file `vi.mock` boilerplate. Tests that need the real helpers
// (`window-label.test.ts`) declare their own `vi.mock` with
// `vi.importActual` to opt back in.
vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(() => null),
  };
});

// Sprint 251 — `dataGridEditStore` is a singleton across the test process.
// Without a per-test reset, pending state from one test leaks into the
// next via the `(connectionId, database, schema, table)` keying — many existing
// suites (`useDataGridEdit.undo.test.ts`, `useDataGridEdit.onblur.test.ts`,
// `DataGrid.editing.test.tsx`, etc.) share the canonical
// `("conn1", "db1", "public", "users")` fixture. Resetting in setup keeps those
// tests byte-identical (no `beforeEach` edits required) while the new
// store backs the per-mount lifecycle correctly.
beforeEach(async () => {
  resetTauriMock();
  useDataGridEditStore.setState({ entries: new Map() });
  // #1270 — `toastStore` is a process singleton like the two stores above.
  // The toast queue never auto-clears (the auto-dismiss timer lives in the
  // React toaster, which most specs don't mount), so a toast surfaced by
  // one test's fire-and-forget async (e.g. DbSwitcher's `void handleSelect`
  // success/error toast) lingers in the global queue. Under parallel-suite
  // load its settle could slip past a sibling test's assertion, flaking
  // `toHaveLength` checks. ~14 specs carried their own per-file reset as a
  // bandaid; resetting here gives every test the same clean-start guarantee
  // the datagrid/tableActivity singletons already get.
  useToastStore.setState({ toasts: [] });
  // #1218 — `tableActivityStore` is a process singleton like the datagrid
  // edit store above. Recording a table open in one test would otherwise
  // leak a Pinned/Recent row into the next SchemaTree render (e.g. duplicate
  // "public.users" text). Reset keeps existing suites byte-identical.
  //
  // Imported dynamically (not at the top of this setup file) so it never
  // eagerly binds the real `@lib/tauri/tableActivity` wrapper before a store
  // spec's per-file `vi.mock` registers — a static import here would defeat
  // that mock and drop the persist assertions.
  const { useTableActivityStore } = await import("@stores/tableActivityStore");
  useTableActivityStore.setState({ entries: [] });
  // #1580 — the workspace persist debounce keeps its timers in module scope
  // (a process singleton like the stores above). A leaked trailing/maxWait
  // timer fires `persistWorkspaces` mid-test; `persist_workspace` is unmocked
  // in most component specs and its `@tauri-apps/api/core` invoke rejects in
  // jsdom, queuing a stray `storageWriteFailed` error toast that flakes a
  // sibling test's `toHaveLength` toast assertion. Drain the timers so a
  // persist scheduled by one test can't fire during the next.
  const { __resetPersistTimerForTests } =
    await import("@stores/workspaceStore/persistence");
  __resetPersistTimerForTests();
});

// crypto.randomUUID polyfill for jsdom (used by FilterBar)
if (typeof crypto.randomUUID !== "function") {
  let counter = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).randomUUID = () => `test-uuid-${++counter}`;
}

// window.matchMedia mock (used by useTheme)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Sprint-112: Radix Select uses pointer-capture + scrollIntoView APIs that
// jsdom doesn't implement. Polyfill them here so the Radix-based <Select>
// component can be opened, navigated, and have its options clicked in tests.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// #1293 — teardown-race flake in `pnpm vitest run`. `@tanstack/virtual-core`
// (via react-virtual `useVirtualizer`) schedules an `isScrollingResetDelay`
// (150ms) *debounce* through `window.setTimeout` whenever a virtualized
// container receives a `scroll` event (`observeElementOffset`). Its
// `Virtualizer.cleanup()` (run by RTL's auto-unmount) removes the scroll
// listeners and cancels its `rafId` but does NOT clear that pending debounce.
// In the jsdom worker `window.setTimeout === globalThis.setTimeout`, so the
// timer is a plain Node timer that can outlive the jsdom `window`. If it fires
// after the run tears the window down, its callback drives react-virtual's
// `onChange` -> React `rerender`, reaching react-dom `resolveUpdatePriority`,
// which reads the now-undefined global `window` and throws
// `ReferenceError: window is not defined` — a run-ending unhandled error
// (Frontend Checks flake; GH Actions runs 29550334891 / 29550826076). Track
// live timers and clear any still pending at the end of each test so none can
// outlive the environment. `vi.useFakeTimers()` swaps `setTimeout` for the
// duration of a test (vitest manages + resets those), so fake timers never
// enter this set; only real timers pass through the wrapper.
{
  const liveTimers = new Set<ReturnType<typeof setTimeout>>();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((
    handler: Parameters<typeof setTimeout>[0],
    timeout?: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => {
    if (typeof handler !== "function") {
      return realSetTimeout(handler, timeout, ...args);
    }
    const id: ReturnType<typeof setTimeout> = realSetTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (...cbArgs: any[]) => {
        liveTimers.delete(id);
        handler(...cbArgs);
      },
      timeout,
      ...args,
    );
    liveTimers.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
    if (id !== undefined)
      liveTimers.delete(id as ReturnType<typeof setTimeout>);
    realClearTimeout(id);
  }) as typeof clearTimeout;
  afterEach(() => {
    for (const id of liveTimers) realClearTimeout(id);
    liveTimers.clear();
  });
}

// Sprint-114: `@tanstack/react-virtual` reads a ResizeObserver from the
// scroll container to react to viewport resizes. jsdom doesn't ship one,
// so the virtualizer crashes during render without this polyfill. We only
// need the no-op surface — tests drive size via `getBoundingClientRect` /
// `clientHeight` overrides where needed.
if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (!g.ResizeObserver) {
    class NoopResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}
