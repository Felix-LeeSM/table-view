import os from "os";
import path from "path";
import fs from "fs";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import type { Options } from "@wdio/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Track the tauri-driver child process
let tauriDriver: ReturnType<typeof spawn> | undefined;
let isShuttingDown = false;

export const config: Options.Testrunner = {
  host: "127.0.0.1",
  port: 4444,

  specs: ["./e2e/**/*.spec.ts"],
  maxInstances: 1,

  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: path.resolve(
          __dirname,
          "src-tauri/target/debug/table-view",
        ),
      },
    },
  ],

  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    // Sprint 172/174 ARIA artifacts confirmed Workspace/SchemaTree ARIA
    // eventually populates (back button + `public schema` + tables all
    // visible in `wdio-report/*win0_aria.txt`), but on cold xvfb +
    // tauri-driver + first-connect the boot+navigate flow can blow past
    // 60s. Bumping to 120s covers cold shards while still failing fast on
    // genuinely stuck tests (the helpers' internal 15→30s probes still
    // bound any single wait).
    timeout: 120000,
  },

  // sprint-174 — When a spec fails on CI we get a generic timeout
  // message and zero forensic context (no screenshot, no DOM, no
  // window-handle inventory). Dump everything we can for every failure
  // into `e2e/wdio-report/` so the docker volume + actions/upload-artifact
  // step surfaces it as a CI artifact. Best-effort: any throw inside the
  // hook is swallowed so we never mask the original failure.
  afterTest: async function (test, _context, { passed }) {
    if (passed) return;
    try {
      const reportDir = path.resolve(__dirname, "e2e/wdio-report");
      fs.mkdirSync(reportDir, { recursive: true });
      const safe = `${test.parent || "root"}__${test.title}`
        .replace(/[^a-z0-9]+/gi, "_")
        .slice(0, 120);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const prefix = `${stamp}__${safe}`;

      let handles: string[] = [];
      try {
        handles = await browser.getWindowHandles();
      } catch (e) {
        fs.writeFileSync(
          `${reportDir}/${prefix}__handles_error.txt`,
          String(e),
        );
        return;
      }

      const inventory: string[] = [];
      for (const [i, h] of handles.entries()) {
        try {
          await browser.switchToWindow(h);
          const title = await browser.getTitle();
          const url = await browser.getUrl();
          inventory.push(`[${i}] handle=${h} title=${title} url=${url}`);
          try {
            const png = await browser.takeScreenshot();
            fs.writeFileSync(
              `${reportDir}/${prefix}__win${i}.png`,
              Buffer.from(png, "base64"),
            );
          } catch (screenshotErr) {
            fs.writeFileSync(
              `${reportDir}/${prefix}__win${i}_screenshot_error.txt`,
              String(screenshotErr),
            );
          }
          try {
            const html = await browser.getPageSource();
            fs.writeFileSync(`${reportDir}/${prefix}__win${i}.html`, html);
          } catch {
            /* ignore */
          }
          try {
            const ariaInventory = await browser.execute(() => {
              const els = document.querySelectorAll("[aria-label]");
              return Array.from(els)
                .slice(0, 200)
                .map(
                  (el) =>
                    `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute("aria-label")}"] visible=${(el as HTMLElement).offsetParent !== null}`,
                );
            });
            fs.writeFileSync(
              `${reportDir}/${prefix}__win${i}_aria.txt`,
              (ariaInventory as string[]).join("\n"),
            );
          } catch {
            /* ignore */
          }
        } catch (e) {
          inventory.push(`[${i}] handle=${h} ERR=${String(e)}`);
        }
      }
      fs.writeFileSync(
        `${reportDir}/${prefix}__windows.txt`,
        inventory.join("\n"),
      );
    } catch (outerErr) {
      console.error("[wdio afterTest dump] failed:", outerErr);
    }
  },

  // Build the Tauri app in debug mode before tests.
  //
  // ADR 0016 — wdio's onPrepare runs *after* run-e2e-docker.sh's tauri
  // build, and without `--config` it would rebuild against the production
  // tauri.conf.json (workspace.visible:false), silently overwriting the
  // e2e overlay binary. Always pass the overlay so both build paths
  // produce a webdriver-visible workspace window. cargo's incremental
  // cache makes the second build a near no-op when the entrypoint already
  // ran one.
  onPrepare: () => {
    console.log("[wdio] Building Tauri debug binary (e2e overlay)...");
    const result = spawnSync(
      "pnpm",
      [
        "tauri",
        "build",
        "--debug",
        "--no-bundle",
        "--config",
        "src-tauri/tauri.e2e.conf.json",
      ],
      {
        cwd: __dirname,
        stdio: "inherit",
        shell: true,
      },
    );
    if (result.status !== 0) {
      throw new Error(`Tauri build failed with exit code ${result.status}`);
    }
    console.log("[wdio] Build complete.");
  },

  // Spawn tauri-driver before each test session
  beforeSession: () => {
    const tauriDriverPath = path.resolve(
      os.homedir(),
      ".asdf/shims/tauri-driver",
    );

    // Fallback: try standard cargo bin path
    const cargoBinPath = path.resolve(os.homedir(), ".cargo/bin/tauri-driver");

    const driverPath = fs.existsSync(tauriDriverPath)
      ? tauriDriverPath
      : cargoBinPath;

    console.log(`[wdio] Starting tauri-driver at ${driverPath}`);
    tauriDriver = spawn(driverPath, [], {
      stdio: [null, process.stdout, process.stderr],
    });

    tauriDriver.on("error", (error: Error) => {
      console.error("[wdio] tauri-driver error:", error);
      if (!isShuttingDown) process.exit(1);
    });

    tauriDriver.on("exit", (code: number | null) => {
      if (!isShuttingDown) {
        console.error("[wdio] tauri-driver exited with code:", code);
        process.exit(1);
      }
    });
  },

  // Clean up tauri-driver after session
  afterSession: () => {
    cleanupDriver();
  },
};

function cleanupDriver() {
  if (tauriDriver && !isShuttingDown) {
    isShuttingDown = true;
    tauriDriver.kill();
    tauriDriver = undefined;
  }
}

// Graceful shutdown handlers
for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cleanupDriver();
    if (signal !== "exit") process.exit(0);
  });
}
