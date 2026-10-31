// SPDX-License-Identifier: GPL-3.0-or-later
// Runs ts-count.run.mts (count-compare.sh) with the web app's test setup (jsdom, $lib); not a unit test.
import config from '../../web/vitest.config.js';

export default {
  ...config,
  test: {
    ...config.test,
    include: ['../koreader/tools/ts-count.run.mts'],
    exclude: [],
    globals: true,
    setupFiles: ['fake-indexeddb/auto']
  }
};
