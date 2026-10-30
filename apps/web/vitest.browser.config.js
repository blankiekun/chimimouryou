import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';
import { extensionProbes } from './src/lib/data/sources/extension-probes/servers.ts';

// Tests in headless Chromium (`pnpm test:browser`): real layout, vertical text, CSS highlights.
// Apart from vitest.config.js so `pnpm test` stays on jsdom and never loads Playwright.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // The fake sites, sinks and probe page of extension-runtime.browser.test.ts.
    plugins: [extensionProbes()],
    test: {
      include: ['src/**/*.browser.test.ts'],
      browser: {
        enabled: true,
        headless: true,
        // CI uses the runner's Google Chrome instead of downloading Playwright's Chromium.
        provider: playwright(process.env.CI ? { launchOptions: { channel: 'chrome' } } : {}),
        instances: [{ browser: 'chromium' }],
        viewport: { width: 1000, height: 700 },
        screenshotFailures: false
      }
    },
    // Found on the first run otherwise, which reloads the test page.
    optimizeDeps: { include: ['kanji-processor'] }
  })
);
