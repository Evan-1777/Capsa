import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CAPSA_E2E_PORT ?? 8123);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL,
    // 驱动本机已安装的 Chrome，不下载 Playwright 自带 chromium。
    channel: "chrome",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bash web/tests/serve.sh`,
    url: baseURL,
    cwd: "..",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
