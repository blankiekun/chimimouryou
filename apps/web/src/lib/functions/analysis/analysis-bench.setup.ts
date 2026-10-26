/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The analysis bench's files (vitest.bench.config.js), fetched once into apps/web/.analysis-bench/
 * (gitignored): the analysis tools as Pages publishes them (scripts/analysis-tools/build.sh's output,
 * ~150 MB; ANALYSIS_TOOLS_DIR names a local build instead) and the Aozora Bunko books, public domain.
 * Runs in Node. Not part of upstream.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const published = 'https://chimireader.github.io/analysis-tools/';

export const benchDir = join(web, '.analysis-bench');
export const toolsDir = process.env.ANALYSIS_TOOLS_DIR
  ? resolve(process.env.ANALYSIS_TOOLS_DIR)
  : join(benchDir, 'analysis-tools');

/**
 * Aozora Bunko pages (Shift_JIS XHTML): 坊っちゃん (Natsume Sōseki), 銀河鉄道の夜 (Miyazawa Kenji), and
 * 吾輩は猫である (Natsume Sōseki) as the long book
 */
export const books = {
  botchan: 'https://www.aozora.gr.jp/cards/000148/files/752_14964.html',
  ginga: 'https://www.aozora.gr.jp/cards/000081/files/456_15050.html',
  neko: 'https://www.aozora.gr.jp/cards/000148/files/789_14547.html'
};

async function download(url: string, file: string) {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, new Uint8Array(await response.arrayBuffer()));
  renameSync(`${file}.part`, file);
}

/** The book's main text, gaiji images as their descriptions, as the import keeps an Aozora page's text */
function mainText(page: string) {
  const body = page
    .split('<div class="main_text">')[1]
    ?.split('<div class="bibliographical_information">')[0];

  if (!body) throw new Error('No main_text in the Aozora page');

  return `<div>${body.replace(/<img[^>]*class="gaiji"[^>]*alt="([^"]*)"[^>]*\/?>/g, '$1')}</div>`;
}

export default async function setup() {
  if (!process.env.ANALYSIS_TOOLS_DIR) {
    const manifest = await (await fetch(`${published}manifest.json`)).json();
    const engine = JSON.parse(
      readFileSync(join(web, 'src/lib/data/difficulty-engine.json'), 'utf8')
    ).engine;

    if (manifest.engine !== engine) {
      console.warn(
        'The published analysis tools are another engine than this tree’s: build.sh, then ANALYSIS_TOOLS_DIR'
      );
    }
    for (const { name, bytes } of manifest.files) {
      const file = join(toolsDir, name);

      if (existsSync(file) && statSync(file).size === bytes) continue;
      console.log(`Downloading ${name} (${(bytes / 1e6).toFixed(1)} MB)`);
      await download(published + name, file);
    }
    writeFileSync(join(toolsDir, 'manifest.json'), JSON.stringify(manifest));
  }
  for (const [name, url] of Object.entries(books)) {
    const file = join(benchDir, 'books', `${name}.html`);

    if (existsSync(file)) continue;

    const page = new TextDecoder('shift_jis').decode(await (await fetch(url)).arrayBuffer());

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, mainText(page));
  }
}
