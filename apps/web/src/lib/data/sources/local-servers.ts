/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** OPDS and Suwayomi servers on this device (standalone): listed, added, removed and browsed. */

import { all, marks, one, put, remove, share, source, type ServerRow } from './local-sources';
import * as opds from './sites/opds';
import { FetchError, NeedsAppError } from './transport';
import { SourceError, type SourceServer, type SourceServerFeed } from './types';

const serverJson = (row: ServerRow): SourceServer => ({
  id: row.id,
  type: row.type,
  name: row.name,
  url: row.url,
  user: row.user,
  hasPassword: !!row.password
});

export async function listServers() {
  return {
    servers: (await all('servers')).filter((s) => !s.deleted).map(serverJson)
  };
}

export async function addServer(input: {
  type: 'opds' | 'suwayomi';
  url: string;
  name: string;
  user: string;
  password: string;
}) {
  if (!['opds', 'suwayomi'].includes(input.type)) throw new SourceError('Choose a type', 'type');
  const url = input.url.trim();
  if (!/^https?:\/\/[^/]+/.test(url)) {
    throw new SourceError('Enter the address with http:// or https://', 'url');
  }
  const existing = (await all('servers')).find((s) => s.url === url);
  if (existing && !existing.deleted) throw new SourceError('This source is already added', 'url');
  const row = {
    ...(existing && { id: existing.id }),
    type: input.type,
    url,
    name: input.name.trim() || new URL(url).host,
    user: input.user,
    password: input.password
  };
  const server = new opds.Server({ id: 0, ...row });
  let feed: opds.Feed;
  try {
    feed = await server.feed(server.root);
  } catch (error) {
    if (error instanceof NeedsAppError) {
      throw new SourceError(
        "This server doesn't let a browser read it (no CORS). The desktop app can.",
        'url'
      );
    }
    if (error instanceof FetchError && (error.status === 401 || error.status === 403)) {
      throw new SourceError('The server refused this user name or password', 'password');
    }
    if (error instanceof opds.NotCatalog) {
      throw new SourceError('The server answered, but not with an OPDS feed', 'url');
    }
    throw new SourceError(error instanceof Error ? error.message : String(error), 'url');
  }
  const id = (await put('servers', row)) as number;
  return {
    server: serverJson((await one('servers', id))!),
    tested: { title: feed.title, entries: feed.entries.length }
  };
}

/** Removes the server; its follows and waiting jobs go, its volumes stay. */
export async function removeServer(id: number) {
  const row = await one('servers', id);
  if (!row) throw new SourceError('No such source');
  await put('servers', { ...row, password: '', deleted: true });
  const works = new Set(
    (await all('works')).filter((w) => w.site === `opds:${id}`).map((w) => w.id)
  );
  for (const follow of await all('follows')) {
    if (!works.has(follow.work)) continue;
    await remove('follows', follow.work);
    await share(follow.work, follow);
  }
  for (const job of await all('jobs')) {
    if (works.has(job.work) && job.state === 'queued') await remove('jobs', job.id);
  }
  return {};
}

/** href as a path on the server (what the page sends back as a section), or null. */
function path(server: opds.Server, href: string | null) {
  try {
    return href ? opds.workKey('opds', server.url(href)) : null;
  } catch {
    return null;
  }
}

export async function browseServer(id: number, section = '', q = ''): Promise<SourceServerFeed> {
  const { server } = await source(`opds:${id}`);
  if (!server) throw new SourceError('No such source');
  const url = q ? await server.searchUrl(q) : section ? server.url(section) : server.root;
  const feed = await server.feed(url);
  const entries: SourceServerFeed['entries'] = [];
  for (const entry of feed.entries) {
    let kind: 'section' | 'work' | 'book';
    let href: string | null = null;
    if (opds.isItem(entry)) {
      kind = 'book';
    } else if (entry.nav && (href = path(server, entry.nav))) {
      kind = entry.navKind === 'acquisition' ? 'work' : 'section';
    } else {
      continue;
    }
    const key = opds.workKey(server.row.type, server.url(href || url));
    entries.push({
      kind,
      title: entry.title,
      authors: entry.authors,
      href,
      workKey: kind === 'section' ? null : key,
      cover: path(server, entry.cover),
      inLibrary: false,
      following: false
    });
  }
  const marked = await marks(
    `opds:${id}`,
    entries.flatMap((e) => (e.workKey ? [e.workKey] : []))
  );
  return {
    server: { id, name: server.row.name, type: server.row.type },
    title: feed.title,
    section: path(server, url) ?? '',
    next: path(server, feed.next),
    search: !!feed.search,
    entries: entries.map((e) => ({
      ...e,
      inLibrary: !!(e.workKey && marked.get(e.workKey)?.inLibrary),
      following: !!(e.workKey && marked.get(e.workKey)?.following)
    }))
  };
}
