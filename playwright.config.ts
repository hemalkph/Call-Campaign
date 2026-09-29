import { defineConfig, devices } from "@playwright/test";

// Needs a production build first: npm run build && npm run test:e2e
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx tsx e2e/serve.mts",
    url: "http://127.0.0.1:3100/login",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
