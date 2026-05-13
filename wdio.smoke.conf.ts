import path from "path";
import fs from "fs";
import net from "net";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import type { Options } from "@wdio/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tauriDriver: ReturnType<typeof spawn> | undefined;
let isShuttingDown = false;

function resolveTauriDriver(): string {
  const fromPath = spawnSync("sh", ["-lc", "command -v tauri-driver"], {
    encoding: "utf-8",
  });
  const candidate = fromPath.stdout.trim();
  if (fromPath.status === 0 && candidate) return candidate;

  const cargoBinPath = path.resolve(
    process.env.HOME ?? "",
    ".cargo/bin/tauri-driver",
  );
  if (fs.existsSync(cargoBinPath)) return cargoBinPath;

  throw new Error(
    "tauri-driver not found on PATH or at ~/.cargo/bin/tauri-driver",
  );
}

async function waitForDriverPort(timeoutMs = 10000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnectToDriver()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `tauri-driver did not listen on 127.0.0.1:4444 within ${timeoutMs}ms`,
  );
}

function canConnectToDriver(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 4444 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function dumpFailureArtifacts(testTitle: string, parentTitle?: string) {
  const reportDir = path.resolve(__dirname, "e2e/wdio-report");
  fs.mkdirSync(reportDir, { recursive: true });
  const safe = `${parentTitle || "root"}__${testTitle}`
    .replace(/[^a-z0-9]+/gi, "_")
    .slice(0, 120);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `${stamp}__${safe}`;

  let handles: string[] = [];
  try {
    handles = await browser.getWindowHandles();
  } catch (e) {
    fs.writeFileSync(`${reportDir}/${prefix}__handles_error.txt`, String(e));
    return;
  }

  const inventory: string[] = [];
  for (const [i, handle] of handles.entries()) {
    try {
      await browser.switchToWindow(handle);
      const title = await browser.getTitle();
      const url = await browser.getUrl();
      inventory.push(`[${i}] handle=${handle} title=${title} url=${url}`);

      try {
        const png = await browser.takeScreenshot();
        fs.writeFileSync(
          `${reportDir}/${prefix}__win${i}.png`,
          Buffer.from(png, "base64"),
        );
      } catch (e) {
        fs.writeFileSync(
          `${reportDir}/${prefix}__win${i}_screenshot_error.txt`,
          String(e),
        );
      }

      try {
        fs.writeFileSync(
          `${reportDir}/${prefix}__win${i}.html`,
          await browser.getPageSource(),
        );
      } catch {
        /* best effort */
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
        /* best effort */
      }
    } catch (e) {
      inventory.push(`[${i}] handle=${handle} ERR=${String(e)}`);
    }
  }

  fs.writeFileSync(`${reportDir}/${prefix}__windows.txt`, inventory.join("\n"));
}

export const config: Options.Testrunner = {
  host: "127.0.0.1",
  port: 4444,
  specs: ["./e2e/smoke/**/*.spec.ts"],
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
    timeout: 120000,
  },
  onPrepare: () => {
    const binary = path.resolve(__dirname, "src-tauri/target/debug/table-view");
    if (!fs.existsSync(binary)) {
      throw new Error(
        `Missing Tauri debug binary at ${binary}. Run pnpm tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json first.`,
      );
    }
  },
  afterTest: async function (test, _context, { passed }) {
    if (!passed) await dumpFailureArtifacts(test.title, test.parent);
  },
  beforeSession: async () => {
    const driverPath = resolveTauriDriver();
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
    await waitForDriverPort();
  },
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

for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cleanupDriver();
    if (signal !== "exit") process.exit(0);
  });
}
