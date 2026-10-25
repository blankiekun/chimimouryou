import { createReadStream, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { mergeConfig } from 'vitest/config';
import browserConfig from './vitest.browser.config.js';
import { benchDir, toolsDir } from './src/lib/functions/analysis/analysis-bench.setup.ts';

// The analysis bench (`pnpm bench:analysis`): the real analysis tools in Chromium on a public-domain
// book. Local only, never in CI: the setup downloads ~150 MB of tools into .analysis-bench/.
const types = {
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
  '.json': 'application/json'
};

/** The tools at /analysis-tools/ and the books at /analysis-bench-books/, as Pages serves them (.gz not decoded). */
const files = {
  name: 'analysis-bench-files',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const match = /^\/(analysis-tools|analysis-bench-books)\/([^?#]+)/.exec(req.url ?? '');
      if (!match) return next();

      const root = match[1] === 'analysis-tools' ? toolsDir : join(benchDir, 'books');
      const file = normalize(join(root, decodeURIComponent(match[2])));

      if (!file.startsWith(root) || !existsSync(file)) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader(
        'Content-Type',
        types[/\.[^.]+$/.exec(file)?.[0]] ?? 'application/octet-stream'
      );
      createReadStream(file).pipe(res);
    });
  }
};

const config = mergeConfig(browserConfig, {
  plugins: [files],
  // Found on the first run otherwise, which reloads the bench page.
  optimizeDeps: { include: ['onnxruntime-web'] },
  test: {
    globalSetup: ['src/lib/functions/analysis/analysis-bench.setup.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000
  }
});

// Set, not merged: mergeConfig would add the browser tests' pattern.
config.test.include = ['src/**/*.bench.browser.ts'];

export default config;
