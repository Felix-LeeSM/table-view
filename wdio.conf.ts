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
    timeout: 60000,
  },

  // Build the Tauri app in debug mode before tests
  onPrepare: () => {
    console.log("[wdio] Building Tauri debug binary...");
    const result = spawnSync(
      "pnpm",
      ["tauri", "build", "--debug", "--no-bundle"],
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
