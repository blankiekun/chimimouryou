/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// rawBookData$ doesn't replay and Svelte 5 subscribes a template `$store` on first render, so a
// pipe of it subscribed inside an {#if} misses the book (the bookmark was lost: books opened at the start).
describe('/b template', () => {
  it('subscribes the pipes of rawBookData$ before any {#if}', () => {
    const source = readFileSync(resolve(__dirname, '+page.svelte'), 'utf8');
    const markup = source.slice(source.lastIndexOf('</script>'));
    const pipes = [...source.matchAll(/const (\w+\$) = rawBookData\$\.pipe\(/g)].map((m) => m[1]);
    const firstIf = markup.indexOf('{#if');

    expect(pipes).toContain('initBookmarkData$');
    for (const name of pipes) {
      const at = markup.indexOf(`{$${name} ?? ''}`);

      // leaveIfBookMissing$ sits in the {:else}, which renders while the book loads.
      if (at >= 0 && name !== 'leaveIfBookMissing$') expect(at, name).toBeLessThan(firstIf);
    }
  });
});
