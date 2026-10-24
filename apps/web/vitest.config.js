import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

// Unit tests (`pnpm test`); see CONTRIBUTING.md for running them without Node.js.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Svelte's browser build, so component tests run onMount and updates.
    resolve: { conditions: ['browser'] },
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'jsdom',
      // Imports JSON without import attributes, which Node refuses outside Vite.
      server: { deps: { inline: ['kanji-processor'] } }
    }
  })
);
