import HomePage from "@/pages/HomePage";

/**
 * LauncherPage — Sprint 150 host shell for the `launcher` window.
 *
 * Phase 12 splits the app into two real Tauri windows; the launcher window
 * (720×560 fixed) hosts connection management while the workspace window
 * (1280×800 resizable) hosts the per-connection work surface. Sprint 150
 * deliberately keeps the launcher's body identical to the previous
 * full-screen `HomePage` — the only difference is the chrome around it (a
 * smaller, fixed-size window) and the fact that no `WorkspacePage` ever
 * mounts as its sibling. UI redesign of this surface is explicitly out of
 * scope this sprint and will land in a later phase if needed.
 *
 * The wrapping `<main>` carries `aria-label="Launcher"` so e2e tooling can
 * disambiguate the launcher from the workspace shell without relying on a
 * `data-testid`. The same surface is also tagged with
 * `data-testid="launcher-page"` so the Sprint 150 boot-routing test
 * (`window-bootstrap.test.tsx`) can assert mount without coupling to the
 * underlying `HomePage` body.
 */
export default function LauncherPage() {
  return (
    <main
      aria-label="Launcher"
      data-testid="launcher-page"
      className="flex h-full w-full"
    >
      <HomePage />
    </main>
  );
}
