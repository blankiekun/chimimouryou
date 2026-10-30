/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * An in-memory /api/v1 for Vitest (server/api/service.py's rules: rows per account, one rev
 * counter, 409 with the stored row for an older `modified`, equal `modified` kept). Install it
 * with `vi.stubGlobal('fetch', api.fetch)`; `requests` lists every call as "METHOD path".
 */

interface Row {
  account: string;
  table: string;
  key: string;
  row: Record<string, any>;
}

export interface FakeBook {
  id: number;
  calibreId: number;
  title: string;
  added?: number;
  format?: string;
  deleted?: boolean;
  [field: string]: unknown;
}

const tables: Record<string, string> = {
  progress: 'progress',
  statistics: 'statistics',
  goals: 'goals',
  highlights: 'highlights',
  docs: 'bookDocs',
  games: 'games',
  series: 'series',
  metadata: 'metadata'
};

export function fakeApi(options: { api?: number | null; account?: () => string } = {}) {
  let rev = 0;
  const rows: Row[] = [];
  const books: (FakeBook & { rev: number })[] = [];
  const files = new Map<string, Blob>();
  const requests: string[] = [];
  const account = options.account || (() => '');

  function addBook(book: FakeBook) {
    rev += 1;
    const index = books.findIndex((other) => other.id === book.id);
    const entry = {
      authors: '',
      series: '',
      seriesIndex: null,
      tags: [],
      added: 0,
      format: 'EPUB',
      file: `${book.title}.epub`,
      cover: '',
      size: 1,
      vn: false,
      key: `uuid-${book.id}`,
      originalTitle: book.title,
      deleted: false,
      ...book,
      rev
    };

    if (index >= 0) books[index] = entry;
    else books.push(entry);
  }

  /** Stores a row as another device would have (no request counted). */
  function setRow(table: string, fields: Record<string, any>, who = account()) {
    rev += 1;
    const key = JSON.stringify([
      table,
      fields.book,
      fields.dateKey,
      fields.goalStart,
      fields.hid,
      fields.kind,
      fields.name
    ]);
    const existing = rows.find((row) => row.account === who && row.key === key);
    const row = { deleted: false, ...fields, rev };

    if (existing) existing.row = row;
    else rows.push({ account: who, table, key, row });

    return row;
  }

  function rowsOf(table: string, who = account()) {
    return rows.filter((row) => row.account === who && row.table === table).map((row) => row.row);
  }

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function keyFields(parts: string[]): [string, Record<string, any>] | undefined {
    const [first, second, third, fourth] = parts;

    if (first === 'books' && third === 'progress') return ['progress', { book: +second }];
    if (first === 'books' && third === 'statistics')
      return ['statistics', { book: +second, dateKey: fourth }];
    if (first === 'books' && third === 'highlights') {
      return ['highlights', { book: +second, hid: decodeURIComponent(fourth) }];
    }
    if (first === 'books' && third === 'docs') return ['bookDocs', { book: +second, kind: fourth }];
    if (first === 'docs') return ['accountDocs', { kind: second }];
    if (first === 'goals') return ['goals', { goalStart: second }];
    if (first === 'series') return ['series', { book: +second }];
    if (first === 'metadata') return ['metadata', { book: +second }];
    if (first === 'games' && second) return ['games', { name: decodeURIComponent(second) }];
    return undefined;
  }

  async function handle(url: string, init: RequestInit = {}) {
    const method = init.method || 'GET';
    const { pathname, searchParams } = new URL(url, 'http://app.test');
    const path = pathname.replace(/^\/api\/v1\//, '');
    const parts = path.split('/');

    requests.push(`${method} ${pathname}${searchParams.size ? `?${searchParams}` : ''}`);

    if (!pathname.startsWith('/api/v1/')) return json(404, { error: 'Not found' });

    if (path === 'version') {
      return options.api === null
        ? json(404, { error: 'Not found' })
        : json(200, { api: options.api ?? 1 });
    }

    const since = Number(searchParams.get('since') || 0);

    if (path === 'catalog') {
      return json(200, {
        rev,
        books: since
          ? books.filter((book) => book.rev > since)
          : books
              .filter((book) => !book.deleted)
              .sort((a, b) => (b.added || 0) - (a.added || 0) || b.id - a.id)
      });
    }

    if (path === 'sync') {
      const result: Record<string, any> = { rev };

      Object.values(tables)
        .concat('accountDocs')
        .forEach((table) => {
          result[table] = rowsOf(table).filter((row) => row.rev > since);
        });

      return json(200, result);
    }

    if (parts[0] === 'books' && parts[2] === 'text') {
      if (method === 'PUT') files.set(path, init.body as Blob);
      return json(200, {});
    }

    const found = keyFields(parts);

    if (!found) return json(404, { error: 'Not found' });

    const [table, fields] = found;
    const isGame = table === 'games';

    if (isGame && method === 'GET') {
      const blob = files.get(`games/${fields.name}`);
      return blob ? new Response(blob) : json(404, { error: 'No such game' });
    }

    const body = isGame ? {} : JSON.parse(String(init.body));
    const modified = isGame ? Number(searchParams.get('modified')) : body.modified;
    const stored = rowsOf(table).find((row) =>
      Object.entries(fields).every(([name, value]) => row[name] === value)
    );

    if (stored && stored.modified > modified) {
      return json(409, { error: 'Newer on the server', row: stored });
    }
    if (stored && stored.modified === modified) return json(200, { rev: stored.rev });

    const deleted = method === 'DELETE' || body.data?.deleted === true;
    let values: Record<string, any>;

    if (isGame) {
      if (method === 'PUT') files.set(`games/${fields.name}`, init.body as Blob);
      else files.delete(`games/${fields.name}`);
      values = { size: method === 'PUT' ? (init.body as Blob).size : 0 };
    } else {
      values = { ...body, data: method === 'DELETE' ? {} : body.data };
    }

    return json(200, { rev: setRow(table, { ...fields, ...values, modified, deleted }).rev });
  }

  return {
    fetch: (url: string | URL | Request, init?: RequestInit) => handle(String(url), init),
    requests,
    files,
    addBook,
    setRow,
    rowsOf,
    /** Like the server's database made again: rows and rev start over. */
    reset() {
      rev = 0;
      rows.length = 0;
      books.forEach((book) => (book.rev = 0));
    }
  };
}

export type FakeApi = ReturnType<typeof fakeApi>;
