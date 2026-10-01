import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Dedicated e2e database + ports so tests never touch development data.
const PG = process.env.TEST_PG_BASE ?? 'localhost:54329';
const API_PORT = 4100,
  WEB_PORT = 5273;
const env = {
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  PUBLIC_WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  DATABASE_URL: `postgres://yalasala_owner:owner_dev_pw@${PG}/yalasala_e2e`,
  APP_DATABASE_URL: `postgres://yalasala_app:app_dev_pw@${PG}/yalasala_e2e`,
  SERVICE_DATABASE_URL: `postgres://yalasala_service:service_dev_pw@${PG}/yalasala_e2e`,
  STORAGE_DIR: './storage-e2e',
};
Object.assign(process.env, env); // the global setup (runs in this process) reads these too
const chromium =
  process.env.CHROMIUM_PATH ??
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      executablePath: chromium,
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions: {
          executablePath: chromium,
          args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../server',
      url: `http://localhost:${API_PORT}/api/health`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
