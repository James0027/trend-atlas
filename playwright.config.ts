import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", timeout: 30_000, fullyParallel: true,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: "list", use: { baseURL: "http://127.0.0.1:4178", trace: "retain-on-failure", channel: process.env.PLAYWRIGHT_CHANNEL },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }],
  webServer: { command: "npm run start -- --port 4178", url: "http://127.0.0.1:4178",
    reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
