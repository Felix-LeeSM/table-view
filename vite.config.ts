/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  // Sprint 385 — `vite-plugin-wasm` lets the dynamic `import()` of the
  // wasm-pack-generated JS glue (`src/lib/sql/wasm/sql_parser_core.js`)
  // resolve its sibling `.wasm` URL correctly through Vite's asset
  // pipeline. We deliberately do NOT pair it with `vite-plugin-top-
  // level-await`: the wasm-pack `--target web` glue uses await only
  // inside async functions (not at module top-level), and the TLA
  // plugin's SWC transform disables esbuild minification for every
  // touched module — that would balloon the main bundle by ~900KB
  // (1.5MB → 2.4MB unminified). Our facade (`sqlAst.ts`) wraps the
  // module init in an async function so no real TLA exists.
  plugins: [wasm(), react(), ...(process.env.VITEST ? [] : [tailwindcss()])],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@stores": path.resolve(__dirname, "./src/stores"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // `.claude/**` / `.codex/**` / `worktrees/**` 는 sub-agent 가 parallel TDD 작업을
    // 진행하는 git worktree 들의 루트. main repo 의 vitest / coverage
    // 측정 범위에서 항상 제외한다 (worktree 내부 test 는 그 worktree 안
    // vitest 가 따로 측정).
    exclude: [
      "e2e/**",
      "node_modules/**",
      ".claude/**",
      ".codex/**",
      "worktrees/**",
    ],
    testTimeout: 10000,

    coverage: {
      reporter: process.env.CI
        ? ["text"]
        : ["text", ["lcov", { projectDirectory: "src" }]],
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        // 2026-06-09 — #580 coverage ratchet. Current measured global
        // coverage: statements 86.14, branches 78.78, functions 88.18,
        // lines 88.70. Thresholds stay below the measured baseline with
        // cushion; per-file thresholds wait until legacy 0% files are covered.
        statements: 85,
        lines: 87,
        functions: 87,
        branches: 78,
      },
    },
  },
  clearScreen: false,
  build: {
    // Tauri desktop bundle 은 사용자 머신에 dist/ 자체를 패키징하지
    // 않지만, sourcemap 을 켜두면 Sentry-like 원격 telemetry 가
    // 활성화될 때 stack trace 를 풀 수 있다. 현재는 telemetry 없으므로
    // false. 추후 활성화 시 본 옵션을 "hidden" 으로 (별도 업로드용
    // map 만 생성).
    sourcemap: false,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/.claude/**",
        "**/.codex/**",
        "**/worktrees/**",
      ],
    },
    fs: {
      // sub-agent worktree 들이 main repo 의 subdirectory 로 배치되지만
      // vite 의 plugin (css-analysis 등) 이 그 경로 안 자산을 따라가지
      // 못하도록 명시 차단. main repo 가 root.
      deny: [".claude/**", ".codex/**", "worktrees/**"],
    },
  },
}));
