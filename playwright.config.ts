import { defineConfig, devices } from '@playwright/test';

const externalBase = process.env.PLAYWRIGHT_BASE_URL;
const externalReference = process.env.PLAYWRIGHT_REFERENCE_URL;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000, toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 } },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: externalBase || 'http://127.0.0.1:4173',
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1600, height: 1000 },
      launchOptions: executablePath ? { executablePath } : {},
    },
  }],
  webServer: [...(externalBase ? [] : [{
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory site',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  }]), ...(externalReference ? [] : [{
    command: 'python3 -m http.server 4174 --bind 127.0.0.1 --directory public',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  }])],
});
