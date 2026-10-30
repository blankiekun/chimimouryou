/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/data/library/book-metadata', () => ({
  searchMetadata: vi.fn(async (kind: string) =>
    kind === 'vn'
      ? [{ title: 'Ever17', url: 'https://vndb.org/v17' }]
      : kind === 'book'
        ? [
            { title: '狼と香辛料', url: 'https://anilist.co/manga/30001/x' },
            { title: 'Jiten', url: 'https://jiten.moe/decks/media/1/detail' }
          ]
        : Promise.reject(new Error('down'))
  )
}));

const { mentionParts, mentionQuery, mentionToken, searchMentions } = await import(
  './community-mentions'
);

describe('community mentions', () => {
  it('renders valid tokens as links, the rest as text', () => {
    expect(mentionParts('読んだ @[狼と香辛料](anilist:30001) と @[Ever17](vndb:v17)!')).toEqual([
      { text: '読んだ ' },
      { title: '狼と香辛料', href: 'https://anilist.co/manga/30001' },
      { text: ' と ' },
      { title: 'Ever17', href: 'https://vndb.org/v17' },
      { text: '!' }
    ]);
    for (const bad of [
      '@[x](https://evil.example)',
      '@[x](anilist:0)',
      '@[x](vndb:17)',
      '@[x](javascript:alert(1))',
      '@[](anilist:1)',
      '@名前'
    ]) {
      expect(mentionParts(bad)).toEqual([{ text: bad }]);
    }
    expect(mentionParts('')).toEqual([]);
  });

  it('makes tokens only for AniList and VNDB pages, without brackets in the title', () => {
    expect(mentionToken('A [B]', 'https://anilist.co/anime/5')).toBe('@[A  B](anilist:5)');
    expect(mentionToken('Ever17', 'https://vndb.org/v17')).toBe('@[Ever17](vndb:v17)');
    expect(mentionToken('x', 'https://jiten.moe/decks/media/1')).toBeNull();
  });

  it('finds the @query before the caret from 2 characters', () => {
    expect(mentionQuery('hi @狼と', 6)).toEqual({ query: '狼と', start: 3 });
    expect(mentionQuery('@ab', 3)).toEqual({ query: 'ab', start: 0 });
    expect(mentionQuery('hi @a', 5)).toBeNull();
    expect(mentionQuery('mail@example', 12)).toBeNull();
    expect(mentionQuery('@[x](vndb:v1)', 13)).toBeNull();
  });

  it('merges the sources, skipping failures and other pages', async () => {
    expect((await searchMentions('x')).map((one) => one.token)).toEqual([
      '@[狼と香辛料](anilist:30001)',
      '@[Ever17](vndb:v17)'
    ]);
  });
});

describe('community text', () => {
  it('shows mentions as links to the work, everything else as text', async () => {
    const { default: CommunityText } = await import(
      '$lib/components/community/community-text.svelte'
    );
    const target = document.createElement('div');

    new CommunityText({
      target,
      props: { text: '読んだ @[狼と香辛料](anilist:30001) <b>x</b> @[x](https://evil.example)' }
    });

    const link = target.querySelector('a')!;

    expect(target.querySelectorAll('a')).toHaveLength(1);
    expect(link.textContent).toBe('@狼と香辛料');
    expect(link.href).toBe('https://anilist.co/manga/30001');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.target).toBe('_blank');
    expect(target.querySelector('b')).toBeNull();
    expect(target.textContent?.trim()).toBe(
      '読んだ @狼と香辛料 <b>x</b> @[x](https://evil.example)'
    );
  });
});
