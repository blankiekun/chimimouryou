/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Renders the Discord app's small art (src/lib/data/discord/discord-art.ts) to 512×512 PNGs in
// apps/anki-discord/art/, for upload to the "Chimi Reader" Discord app (see that folder's README).
// Run from apps/web: node scripts/discord-art.mjs (Node 24 strips the module's types).
/* global console -- Node */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { artKinds, artSvg, ringSteps } from '../src/lib/data/discord/discord-art.ts';

const out = fileURLToPath(new URL('../../anki-discord/art/', import.meta.url));
const keys = [
  ...ringSteps.map((step) => `ring-${step}`),
  ...artKinds.map((kind) => `kind-${kind}`)
];

await mkdir(out, { recursive: true });

const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

  for (const key of keys) {
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${artSvg(key)}`
    );
    await page.locator('svg').screenshot({ path: `${out}${key}.png`, omitBackground: true });
  }
  console.log(`${keys.length} images in ${out}`);
} finally {
  await browser.close();
}
