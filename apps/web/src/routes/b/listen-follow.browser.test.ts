/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewMode } from '$lib/data/view-mode';
// @ts-expect-error tsconfig's moduleResolution "node" doesn't read package exports; Vitest does.
import { page as browserPage, userEvent } from 'vitest/browser';
import { autoBookmarkTime$, database } from '$lib/data/store';
import { connectProvider, deleteConnection } from '$lib/data/ai-connections';
import { ttsVoiceId$ } from '$lib/data/ai-settings';
import {
  addBook,
  mountReader,
  paragraphAt,
  togglePanel,
  visibleParagraphs,
  waitOnScreen
} from './reader-fixture';

/*
 * The whole /b page with Listen → AI voice reading aloud: only ElevenLabs (the network) is stubbed,
 * answering each chunk with a short silent clip. The page must follow the voice and the auto
 * bookmark must save where the voice took it, in every view mode (paginated saved nothing: its
 * auto bookmark only counted the reader's own page turns).
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
  vi.unstubAllGlobals();
  deleteConnection('elevenlabs');
  autoBookmarkTime$.next(3);
});

/** A silent 8 kHz WAV of `seconds`, base64 (Chromium sniffs it whatever the type says). */
function silence(seconds: number) {
  const samples = Math.round(8000 * seconds);
  const bytes = new Uint8Array(44 + samples).fill(128);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  return btoa(String.fromCharCode(...bytes));
}

function stubElevenLabs() {
  const realFetch = fetch;
  const audio = silence(0.15);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes('/text-to-speech/')) return realFetch(input, init);
    const characters = [...JSON.parse(String(init!.body)).text] as string[];
    const times = characters.map((_, i) => (0.1 * i) / characters.length);
    return new Response(
      JSON.stringify({
        audio_base64: audio,
        alignment: {
          characters,
          character_start_times_seconds: times,
          character_end_times_seconds: times
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  });
}

describe('/b Listen → AI voice: the page follows the voice and the auto bookmark saves', () => {
  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      it(`${view}, ${writing}`, async () => {
        autoBookmarkTime$.next(0.5);
        connectProvider('elevenlabs', 'test-key');
        ttsVoiceId$.next('voice');
        stubElevenLabs();
        const id = await addBook(2, 25, true);
        const before = (await database.getBookmark(id))!.exploredCharCount!;
        component = await mountReader(id, view, writing);
        await waitOnScreen('p-2-25');
        const start = visibleParagraphs();

        await togglePanel();
        await vi.waitFor(() =>
          [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
            .find((tab) => tab.textContent?.trim() === 'Listen')!
            .click()
        );
        // A real click: <audio> plays only after the user interacted with the page.
        await vi.waitFor(() =>
          expect(document.querySelector('button[title="Read aloud from here"]')).toBeTruthy()
        );
        await userEvent.click(document.querySelector('button[title="Read aloud from here"]')!);

        // The voice reads on past the page: the reader must turn or scroll to it.
        await vi.waitFor(
          () => expect(visibleParagraphs().some((p) => start.includes(p))).toBe(false),
          { timeout: 20_000 }
        );
        document.querySelector<HTMLElement>('button[title="Pause"]')?.click();
        const shown = visibleParagraphs();

        await vi.waitFor(
          async () => {
            const saved = (await database.getBookmark(id))!.exploredCharCount!;
            expect(saved, `before ${before}, shown ${shown}`).toBeGreaterThan(before);
            expect(shown).toContain(paragraphAt(saved, true));
          },
          { timeout: 5000 }
        );
        await browserPage.viewport(1000, 700);
      }, 40_000);
    }
  }
});
