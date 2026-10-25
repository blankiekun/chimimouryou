import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

// Tests in headless Chromium (`pnpm test:browser`): real layout, vertical text, CSS highlights.
// Apart from vitest.config.js so `pnpm test` stays on jsdom and never loads Playwright.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.browser.test.ts'],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        viewport: { width: 1000, height: 700 },
        screenshotFailures: false
      }
    },
    // Found on the first run otherwise, which reloads the test page.
    optimizeDeps: { include: ['kanji-processor'] }
  })
);
