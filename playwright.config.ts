import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const PORT = 4173;
// The sandbox's Chromium when it is there (or PW_CHROMIUM); elsewhere Playwright's own (npx playwright install chromium).
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: "block",
    timezoneId: "Europe/Belgrade",
    locale: "sr-Latn-RS",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // The browser itself stays quiet too: no Google services, sync or field trials during tests.
      args: ["--disable-background-networking", "--disable-sync", "--no-first-run",
        "--disable-features=AutofillServerCommunication,OptimizationHints,MediaRouter,Translate"],
    },
  },
  webServer: {
    command: `node tests/e2e/serve.mjs dist ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
  },
  projects: [
    { name: "e2e", testMatch: /.*\.spec\.ts/, testIgnore: /shots\.spec\.ts/ },
    { name: "shots", testMatch: /shots\.spec\.ts/ },
  ],
});
