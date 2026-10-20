// Smoke tests run against the static app in a phone-sized browser.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8080/',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'python3 -m http.server 8080 --directory app',
    url: 'http://localhost:8080/',
    reuseExistingServer: true,
  },
});
