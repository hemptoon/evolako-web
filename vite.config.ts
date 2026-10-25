import { readFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { swPlugin } from "./build/sw-plugin";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const buildDate = process.env.EVO_BUILD_DATE ?? new Date().toISOString().slice(0, 10);

export default defineConfig({
  plugins: [preact(), swPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    target: "es2022",
    // Never inline assets as data: URIs — fonts must come from 'self' (CSP font-src).
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
