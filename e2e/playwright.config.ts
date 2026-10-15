import { defineConfig } from "@playwright/test";

const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// One worker + serial files: the backend is a single in-memory world that every test resets.
export default defineConfig({
  testDir: "./specs",
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8080",
    launchOptions: { executablePath: CHROMIUM, args: ["--no-sandbox"] },
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "python backend_server.py 8000",
      url: "http://127.0.0.1:8000/",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npx vite dev --port 8080 --host 127.0.0.1",
      cwd: "../frontend",
      url: "http://127.0.0.1:8080/",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: "http://127.0.0.1:8000",
        VITE_PEERMEET_URL: "http://127.0.0.1:5173",
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: "anon",
      },
    },
    {
      command: "node src/index.js",
      cwd: "../PeerMeet/server",
      url: "http://127.0.0.1:5001/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: { PORT: "5001", CLIENT_URL: "http://127.0.0.1:5173", PEERMEET_SHARED_SECRET: "e2e-secret",
             MIRRACLE_WEBHOOK_URL: "http://127.0.0.1:8000" },
    },
    {
      command: "npx vite --port 5173 --host 127.0.0.1",
      cwd: "../PeerMeet/client",
      url: "http://127.0.0.1:5173/",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_SERVER_URL: "http://127.0.0.1:5001" },
    },
  ],
});
