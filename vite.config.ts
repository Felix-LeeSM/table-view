/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), ...(process.env.VITEST ? [] : [tailwindcss()])],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@stores": path.resolve(__dirname, "./src/stores"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // `.claude/**` 는 sub-agent 가 parallel TDD 작업을 진행하는
    // git worktree 들의 루트. main repo 의 vitest / coverage 측정 범위에서
    // 항상 제외한다 (worktree 내부 test 는 그 worktree 안 vitest 가 따로
    // 측정).
    exclude: ["e2e/**", "node_modules/**", ".claude/**"],
    testTimeout: 10000,

    coverage: {
      reporter: process.env.CI
        ? ["text"]
        : ["text", ["lcov", { projectDirectory: "src" }]],
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        // 2026-05-07 — pre-push gate 도입과 함께 일괄 70% 상향. 부족분은
        // 신규 테스트 추가로 메운다 (사용자 결정). 이전 기준 68/64/60 은
        // Sprint 9 직후의 "현실적 floor" 였으나, 코드베이스가 충분히
        // 자라 70 일괄 적용이 가능한 시점.
        // perFile 임계값은 0% 파일이 커버된 후 도입.
        lines: 70,
        functions: 70,
        branches: 70,
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
      ignored: ["**/src-tauri/**", "**/.claude/**"],
    },
    fs: {
      // sub-agent worktree 들이 main repo 의 subdirectory 로 배치되지만
      // vite 의 plugin (css-analysis 등) 이 그 경로 안 자산을 따라가지
      // 못하도록 명시 차단. main repo 가 root.
      deny: [".claude/**"],
    },
  },
}));
