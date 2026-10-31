// SPDX-License-Identifier: GPL-3.0-or-later
// The web reader's side of count-compare.sh: loads each EPUB in COUNT_BOOKS (comma-separated) the way
// the reader does (loadEpub, then format-book-data-html.ts's parse and .placeholder-br removal), counts
// each spine item's section with the reader's own functions and writes per-section totals and sample
// positions (the next counted characters at a few counts) to COUNT_OUT as JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
// The web app's own zip.js (a bare import would resolve from this folder, which has no node_modules).
import { configure } from '$lib/../../node_modules/@zip.js/zip.js/index.js';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import { parseBookHtml } from '$lib/functions/file-loaders/utils/sanitize-book-html';
import { getTextSegments, gaijiPlaceholder } from '$lib/functions/book-text/text-positions';
import { isCountedCharacter } from '$lib/functions/get-character-count';

const SAMPLES = 5;
const SPAN = 6;

test('count books', async () => {
  // jsdom has no Worker.
  configure({ useWebWorkers: false });
  // jsdom matches 'navLabel' case-sensitively in an NCX parsed as HTML (browsers don't). Only
  // chapter labels come from there, never counts.
  const querySelector = Element.prototype.querySelector;
  Element.prototype.querySelector = function (selector) {
    return querySelector.call(this, selector === 'navLabel text' ? 'navlabel text' : selector);
  };
  // jsdom never loads images, so the cover check would wait forever: fail them at once.
  globalThis.Image = class extends EventTarget {
    set src(_) {
      setTimeout(() => this.dispatchEvent(new Event('error')));
    }
  };
  const out = {};

  for (const path of (process.env.COUNT_BOOKS || '').split(',').filter(Boolean)) {
    const file = new File([readFileSync(path)], basename(path));
    const data = await loadEpub(file, document, 0);
    const root = parseBookHtml(data.elementHtml);

    root.querySelectorAll('.placeholder-br').forEach((el) => el.remove());

    const sections = [...root.children].map((section) => {
      const chars = [];

      for (const segment of getTextSegments(section)) {
        for (const char of segment.text) {
          if (char === gaijiPlaceholder || isCountedCharacter(char)) chars.push(char);
        }
      }

      const samples = [];

      for (let k = 0; chars.length && k < SAMPLES; k++) {
        const at = Math.floor((k * (chars.length - 1)) / (SAMPLES - 1));

        samples.push({ at, text: chars.slice(at, at + SPAN).join('') });
      }

      return { id: section.id, count: chars.length, samples };
    });

    out[basename(path)] = { characters: data.characters, sections };
  }

  writeFileSync(process.env.COUNT_OUT || 'ts-count.json', JSON.stringify(out));
}, 600_000);
