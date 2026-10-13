import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/._*",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- -p 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
