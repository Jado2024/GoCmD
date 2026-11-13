import { defineConfig } from "@playwright/test"

/** E2E GoCmd — uniquement localhost + base isolée jetable (contrôlé par le lanceur). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.GOCMD_E2E_URL || "http://127.0.0.1:3999",
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
})
