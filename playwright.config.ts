import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';

const TEST_PORT = 13456;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: `https://localhost:${TEST_PORT}`,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: join(__dirname, 'test/e2e/global-setup.ts'),
  globalTeardown: join(__dirname, 'test/e2e/global-teardown.ts'),
});
