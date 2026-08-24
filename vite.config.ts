/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // CM6 editor mounts are timing-sensitive under jsdom; full-width worker
    // pools made 1-2 files fail nondeterministically per run (they always
    // pass standalone). Cap workers and run files sequentially per worker.
    maxWorkers: 2,
    fileParallelism: false,
    testTimeout: 20000,
  },
}));
