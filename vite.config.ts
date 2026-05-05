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
    exclude: ["e2e/**", "node_modules/**"],

    coverage: {
      reporter: process.env.CI
        ? ["text"]
        : ["text", ["lcov", { projectDirectory: "src" }]],
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        // Sprint 9 이후 70%+ 달성
        // perFile은 기존 0% 파일이 커버된 후 도입 예정
        lines: 68,
        functions: 64,
        branches: 60,
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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
