/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewMode } from '$lib/data/view-mode';
import { openReader } from './reader-fixture';

/*
 * Paginated: a page turn drops the reading point, even after a window `resize` that left the
 * reader's size as it was (a phone's URL bar, fullscreen toggled back). Such a resize used to leave
 * the reader "resizing" forever, so the old reading point stayed and skewed the progress.
 */

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn()
}));
vi.mock('$lib/data/page-store', async () => {
  const { writable } = await import('svelte/store');
  return { page: writable({ url: new URL(location.href), route: { id: '/b' }, state: {} }) };
});

let component: { $destroy(): void } | undefined;

afterEach(() => {
  component?.$destroy();
  component = undefined;
  document.body.innerHTML = '';
  scrollTo(0, 0);
});

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/** The reader's More sheet items, opened from the bar. */
async function moreItems() {
  (document.querySelector('button.fixed.inset-x-0.top-0') as HTMLElement).click();
  await vi.waitFor(() => {
    const more = document.querySelector<HTMLElement>('button[title="More reader actions"]');
    expect(more).toBeTruthy();
    more!.click();
  });
  await vi.waitFor(() => expect(document.querySelector('.more-item')).toBeTruthy());
  return [...document.querySelectorAll<HTMLElement>('.more-item')];
}

const item = (items: HTMLElement[], text: string) =>
  items.find((el) => el.textContent?.trim() === text);

describe('/b paginated: a page turn drops the reading point', () => {
  for (const resize of [false, true]) {
    it(resize ? 'after a same-size resize' : 'without a resize', async () => {
      component = await openReader(ViewMode.Paginated, 'horizontal-tb');
      await settle();

      item(await moreItems(), 'Set reading point')!.click();
      await settle();
      document.dispatchEvent(
        new PointerEvent('pointerup', { clientX: innerWidth / 2, clientY: innerHeight / 2 })
      );
      await settle();
      expect(item(await moreItems(), 'Reset reading point')).toBeTruthy();
      (document.querySelector('.more-item') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      await settle();

      if (resize) dispatchEvent(new Event('resize'));
      await settle();
      dispatchEvent(new KeyboardEvent('keydown', { code: 'PageDown', key: 'PageDown' }));
      await settle();

      expect(item(await moreItems(), 'Reset reading point')).toBeUndefined();
    });
  }
});
