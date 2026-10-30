/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * @ mentions of works in Community posts. The body keeps a mention as plain text,
 * `@[Title](anilist:<id>)` or `@[Title](vndb:v<id>)` (no `://`, so the hub's link check for new
 * accounts lets it through; the hub refuses any other target). Shown as a link to the work's page;
 * nothing is fetched to show one. Suggestions come from AniList/VNDB (searchMetadata), only once
 * the reader typed `@` and 2 characters. Not part of upstream.
 */

import { searchMetadata, type MetadataCandidate } from '$lib/data/book-metadata';

export type MentionPart = { text: string } | { title: string; href: string };

/** The same shape the hub checks (deploy/social-hub/src/community.ts MENTION) */
const MENTION = /@\[([^[\]\n]{1,200})\]\(([^()\n]*)\)/g;

/** A mention's page: AniList searches are books and manga only (type MANGA), so /manga/ */
export function mentionHref(target: string) {
  const anilist = /^anilist:([1-9]\d{0,8})$/.exec(target);
  const vndb = /^vndb:(v[1-9]\d{0,8})$/.exec(target);

  if (anilist) return `https://anilist.co/manga/${anilist[1]}`;
  return vndb ? `https://vndb.org/${vndb[1]}` : null;
}

/** A post's text as plain runs and mentions; malformed tokens stay plain text */
export function mentionParts(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let at = 0;

  for (const match of text.matchAll(MENTION)) {
    const href = mentionHref(match[2]);

    if (!href) continue;
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ title: match[1], href });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** The token for an AniList or VNDB page, null for other pages */
export function mentionToken(title: string, url: string) {
  const anilist = /^https:\/\/anilist\.co\/(?:manga|anime)\/([1-9]\d{0,8})(?:\/|$)/.exec(url);
  const vndb = /^https:\/\/vndb\.org\/(v[1-9]\d{0,8})(?:\/|$)/.exec(url);
  const target = anilist ? `anilist:${anilist[1]}` : vndb ? `vndb:${vndb[1]}` : null;
  const name = title
    .replace(/[[\]\n]+/g, ' ')
    .trim()
    .slice(0, 200);

  return target && name ? `@[${name}](${target})` : null;
}

/** The `@query` being typed just before the caret (2-30 characters), else null */
export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|\s)@([^\n@[\]()]{2,30})$/u.exec(text.slice(0, caret));

  return match ? { query: match[1], start: caret - match[1].length - 1 } : null;
}

/** Books, manga (AniList) and visual novels (VNDB) for `query`, with their tokens, at most 8 */
export async function searchMentions(query: string) {
  const lists = await Promise.allSettled(
    (['book', 'manga', 'vn'] as const).map((kind) => searchMetadata(kind, query))
  );
  const found = lists.map((list) => (list.status === 'fulfilled' ? list.value : []));
  const merged: (MetadataCandidate & { token: string })[] = [];

  // Interleaved, so each source shows its best
  for (let rank = 0; rank < 8; rank++) {
    for (const list of found) {
      const candidate = list[rank];
      const token = candidate && mentionToken(candidate.title, candidate.url);

      if (token && !merged.some((one) => one.token === token)) merged.push({ ...candidate, token });
    }
  }
  return merged.slice(0, 8);
}
