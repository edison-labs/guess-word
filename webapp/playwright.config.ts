import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'outputs/playwright-report' }]],
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'npm run dev -- --port 3100',
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: false,
        env: {
          CLOUDFLARE_ENV: 'e2e',
          APP_ENV: 'test',
          SEMANTIC_PROVIDER: 'deterministic',
          TEST_QUESTION_ID: 'animal_penguin',
        },
      },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
