import HomePage from "@/pages/HomePage";

/**
 * Host shell for the `launcher` window (720×560 fixed) — connection
 * management. Body is identical to the full-screen `HomePage`; only the
 * window chrome differs.
 *
 * The wrapping `<main>` carries `aria-label="Launcher"` so e2e tooling can
 * disambiguate the launcher from the workspace shell without a
 * `data-testid`. The surface also carries `data-testid="launcher-page"`
 * so the boot-routing test (`window-bootstrap.test.tsx`) can assert mount
 * without coupling to the underlying `HomePage` body.
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
