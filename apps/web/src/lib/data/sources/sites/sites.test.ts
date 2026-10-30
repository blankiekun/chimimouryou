/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The TypeScript site adapters against the same fake sites and saved pages as the Python ones
 * (server/tests/test_sources.py, fixtures/sources/). Ways a port can fail, each checked below:
 * - a look-alike host (ncode.syosetu.com.evil.example) or a non-http link passes parseUrl, so the
 *   app fetches from another site; a work's chapter link or upper-case key gives another key
 * - details count the wrong chapters, miss the latest ones on the last index page (?p=2), take a
 *   short story for a serial, or turn a removed work into an empty work instead of SiteMissing
 * - a chapter loses its preface/afterword order or ruby, or keeps the site's chrome and scripts
 * - clean() lets scripts, handlers, links or images through, or yields XHTML that doesn't parse
 *   (the EPUB would not open), or escapes entities twice
 * - Kakuyomu: episodes of later sections dropped, a list shorter than the count not caught (a
 *   volume would silently skip chapters), Japan's date taken as UTC, a 404 not SiteMissing,
 *   chapter n past the end fetched
 * - the EPUB: mimetype not first and stored, series metas missing (the volume leaves its series),
 *   & < " in titles break the package
 * - OPDS: navigation vs acquisition links mixed up, PSE pages or next/search links lost, an HTML
 *   page or JSON taken for a catalog
 * - the planner's volume edges (0, 1, 50, 101 chapters)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BlobReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js';
import { fixtures, startFakeSites } from '../fake-sites';
import { clean, epub, plan } from './build';
import * as kakuyomu from './kakuyomu';
import * as opds from './opds';
import { SiteMissing } from './site';
import * as syosetu from './syosetu';

configure({ useWebWorkers: false });

const KAKU = 'https://kakuyomu.jp/works/1177354054000000001';
let sites: Awaited<ReturnType<typeof startFakeSites>>;

beforeAll(async () => {
  sites = await startFakeSites();
});
afterAll(() => sites.stop());

const xml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
};

describe('syosetu', () => {
  it('reads only work links on its hosts', () => {
    const work = 'https://ncode.syosetu.com/n0001aa/';
    for (const link of [
      work,
      'http://ncode.syosetu.com/n0001aa',
      'https://ncode.syosetu.com/N0001AA/12/',
      'https://ncode.syosetu.com/n0001aa/?p=2',
      ' https://ncode.syosetu.com/novelview/infotop/ncode/n0001aa/ '
    ]) {
      expect(syosetu.parseUrl(link), link).toEqual(['n0001aa', work]);
    }
    expect(syosetu.parseUrl('https://novel18.syosetu.com/n0002bb/3/')).toEqual([
      'n0002bb',
      'https://novel18.syosetu.com/n0002bb/'
    ]);
    for (const link of [
      'https://ncode.syosetu.com.evil.example/n0001aa/',
      'https://evil.example/ncode.syosetu.com/n0001aa/',
      'https://mypage.syosetu.com/288399/',
      'javascript:alert(1)//ncode.syosetu.com/n0001aa/',
      'https://ncode.syosetu.com/',
      'n0001aa',
      ''
    ]) {
      expect(syosetu.parseUrl(link), link).toBeNull();
    }
  });

  it('reads details, the latest chapters from the last index page, and a removed work', async () => {
    const work = await syosetu.details('https://ncode.syosetu.com/n0001aa/');
    expect([work.title, work.authors, work.status, work.chapters, work.short]).toEqual([
      '春の手紙　～試験の物語～',
      '試験作者',
      'ongoing',
      103,
      false
    ]);
    expect(work.latest[0]).toEqual({ n: 103, title: '第百三話　手紙の&返事', date: '2026-10-27' });
    expect(work.latest.map((c) => c.n)).toEqual([103, 102, 101]);
    await expect(syosetu.details('https://ncode.syosetu.com/n0009zz/')).rejects.toBeInstanceOf(
      SiteMissing
    );
  });

  it('reads a short story from its work page and a chapter without the site around it', async () => {
    const short = await syosetu.details('https://novel18.syosetu.com/n0002bb/');
    expect([short.title, short.chapters, short.short, short.status]).toEqual([
      '夜の短編',
      1,
      true,
      'finished'
    ]);
    const story = await syosetu.chapter('https://novel18.syosetu.com/n0002bb/', 1, short);
    expect(story.html).toContain('<ruby>長<rt>なが</rt></ruby>');

    const chapter = await syosetu.chapter('https://ncode.syosetu.com/n0001aa/', 7, {
      ...short,
      short: false
    });
    expect(chapter.title).toBe('第7話「手紙」');
    expect(chapter.html.indexOf('前書き')).toBeLessThan(chapter.html.indexOf('7通目'));
    expect(chapter.html.indexOf('7通目')).toBeLessThan(chapter.html.indexOf('後書き'));
    expect(chapter.html).toContain('<rt>しょうじょ</rt>');
    expect(chapter.html).not.toContain('gnshbrequest');
    expect(chapter.html).not.toContain('ブックマーク');
  });

  it('lists search results', async () => {
    const found = await syosetu.search('手紙', 1);
    expect(found.total).toBe(57);
    expect(found.more).toBe(true);
    expect(found.works[0]).toMatchObject({ workKey: 'n0001aa', title: '春の手紙　～試験の物語～' });
  });
});

describe('kakuyomu', () => {
  it('reads only work links on kakuyomu.jp', () => {
    for (const link of [
      KAKU,
      `${KAKU}/`,
      'http://kakuyomu.jp/works/1177354054000000001',
      `${KAKU}/episodes/1177354054000200007`,
      `${KAKU}?utm=x`,
      ` ${KAKU}/episodes/1177354054000200007/ `
    ]) {
      expect(kakuyomu.parseUrl(link), link).toEqual(['1177354054000000001', KAKU]);
    }
    for (const link of [
      'https://kakuyomu.jp.evil.example/works/1',
      'https://evil.example/kakuyomu.jp/works/1',
      'https://kakuyomu.jp/users/shiken',
      'https://kakuyomu.jp/works/abc',
      'https://kakuyomu.jp/',
      'https://ncode.syosetu.com/n0001aa/',
      ''
    ]) {
      expect(kakuyomu.parseUrl(link), link).toBeNull();
    }
  });

  it('reads every section of the table of contents, in Japan time', async () => {
    const work = await kakuyomu.details(`${KAKU}/episodes/1177354054000200003`);
    expect([work.title, work.authors, work.status, work.chapters, work.short]).toEqual([
      '風の便り　～試験の旅～',
      '試験書き手',
      'ongoing',
      53,
      false
    ]);
    expect(work.episodes?.[0]).toBe('1177354054000200001');
    expect(work.episodes?.[30]).toBe('1177354054000200031');
    expect(work.episodes).toHaveLength(53);
    expect(work.latest.map((c) => c.n)).toEqual([53, 52, 51]);
    // 2026-10-26T15:30Z is Oct 27 in Japan.
    expect(work.latest[0].date).toBe('2026-10-27');
    expect(work.cover).toBe('https://cdn.kdkw.jp/cover_1000/0000/0001.png');
    await expect(
      kakuyomu.details('https://kakuyomu.jp/works/1177354054000000404')
    ).rejects.toBeInstanceOf(SiteMissing);
  });

  it('fetches the n-th episode, never one past the end', async () => {
    const work = await kakuyomu.details(KAKU);
    const chapter = await kakuyomu.chapter(KAKU, 31, work);
    expect(chapter.title).toBe('第1177354054000200031話　風の&便り');
    expect(chapter.html).toContain(
      '<ruby><rb>少年</rb><rp>（</rp><rt>しょうねん</rt><rp>）</rp></ruby>'
    );
    expect(chapter.html).toContain('<em>手紙</em>');
    for (const chrome of ['次のエピソード', '応援する', 'alert', '出会い']) {
      expect(chapter.html).not.toContain(chrome);
    }
    await expect(kakuyomu.chapter(KAKU, 54, work)).rejects.toBeInstanceOf(SiteMissing);
  });

  it('notices when the pages changed', () => {
    const page = readFileSync(`${fixtures}kakuyomu/work-1177354054000000001.html`, 'utf8');
    const key = '1177354054000000001';
    const short = page.replace('"publicEpisodeCount": 53', '"publicEpisodeCount": 54');
    expect(short).not.toBe(page);
    expect(kakuyomu.parseDetails(page, key).chapters).toBe(53);
    for (const broken of [
      '<html><body>maintenance</body></html>',
      page.replaceAll('__NEXT_DATA__', '__DATA__'),
      page.replaceAll(`Work:${key}`, 'Work:9'),
      short
    ]) {
      expect(() => kakuyomu.parseDetails(broken, key)).toThrow(/changed/);
    }
    expect(() => kakuyomu.parseChapter('<html><div class="episodeBody">x</div></html>')).toThrow();
  });
});

describe('build', () => {
  it('cleans chapter HTML into well-formed XHTML', () => {
    const out = clean(
      '<p>A&amp;B <span style="x" onclick="y">c</span><script>alert(1)</script>' +
        '<a href="//x"><img src="//x/i.jpg"></a><ruby><rb>漢</rb><rp>(</rp><rt>かん</rt><rp>)</rp></ruby>' +
        '<p>unclosed<br><b>bold</i></div>&lt;tag&gt; & bare'
    );
    xml(`<body xmlns="http://www.w3.org/1999/xhtml">${out}</body>`);
    for (const gone of ['script', 'alert', 'onclick', 'style', '<img', 'href', '<span', '<a']) {
      expect(out).not.toContain(gone);
    }
    expect(out).toContain('<ruby><rb>漢</rb><rp>(</rp><rt>かん</rt><rp>)</rp></ruby>');
    expect(out).toContain('A&amp;B c');
    expect(out).toContain('&lt;tag&gt; &amp; bare');
  });

  it('builds an EPUB in its series', async () => {
    const file = await epub({
      title: 'A&B <"作品"> 2',
      authors: '著者',
      series: 'A&B <"作品">',
      seriesIndex: 2,
      identifier: 'chimi:syosetu:n0001aa:2',
      chapters: [
        { title: '第1話 <&>', xhtml: clean('<p>一</p>') },
        { title: '', xhtml: clean('<p>二<ruby>字<rt>じ</rt></ruby></p>') }
      ]
    });
    const reader = new ZipReader(new BlobReader(file));
    const entries = await reader.getEntries();
    expect(entries[0].filename).toBe('mimetype');
    expect(entries[0].compressedSize).toBe(entries[0].uncompressedSize);
    const read = (name: string) =>
      entries.find((e) => e.filename === name)!.getData!(new TextWriter());
    const opf = xml(await read('OEBPS/content.opf'));
    expect(opf.getElementsByTagName('dc:title')[0].textContent).toBe('A&B <"作品"> 2');
    const metas = Object.fromEntries(
      [...opf.getElementsByTagName('meta')].map((m) => [
        m.getAttribute('name'),
        m.getAttribute('content')
      ])
    );
    expect([metas['calibre:series'], metas['calibre:series_index']]).toEqual(['A&B <"作品">', '2']);
    expect(opf.getElementsByTagName('spine')[0].getAttribute('page-progression-direction')).toBe(
      'rtl'
    );
    for (const name of ['OEBPS/nav.xhtml', 'OEBPS/c0001.xhtml', 'OEBPS/c0002.xhtml']) {
      xml(await read(name));
    }
    expect(await read('OEBPS/c0002.xhtml')).toContain('<rt>じ</rt>');
    expect(await read('OEBPS/style.css')).toContain('vertical-rl');
    await reader.close();
  });

  it('plans volumes of 50 chapters', () => {
    expect(plan(0)).toEqual([]);
    expect(plan(1)).toEqual([{ number: 1, first: 1, last: 1 }]);
    expect(plan(50)).toEqual([{ number: 1, first: 1, last: 50 }]);
    expect(plan(101)).toEqual([
      { number: 1, first: 1, last: 50 },
      { number: 2, first: 51, last: 100 },
      { number: 3, first: 101, last: 101 }
    ]);
  });
});

describe('opds', () => {
  const server = (url: string, type: 'opds' | 'suwayomi' = 'opds') =>
    new opds.Server({ id: 1, type, name: 'Fake', url, user: 'reader', password: 'kagi-1234' });

  it('reads navigation, acquisition and page links', async () => {
    const komga = server(`${sites.base}/opds/catalog`);
    const root = await komga.feed(komga.root);
    expect(root.title).toBe('試験カタログ');
    expect(root.search).toEqual([
      `${sites.base}/opds/search.xml`,
      'application/opensearchdescription+xml'
    ]);
    expect(root.entries.map((e) => [e.title, e.nav, e.navKind])).toEqual([
      ['All series', `${sites.base}/opds/series`, 'navigation'],
      ['Broken', `${sites.base}/opds/broken`, 'navigation']
    ]);
    const listing = await komga.feed(`${sites.base}/opds/series`);
    expect(listing.next).toBe(`${sites.base}/opds/series?page=2`);
    expect([listing.entries[0].navKind, listing.entries[0].cover]).toEqual([
      'acquisition',
      `${sites.base}/opds/covers/s1.png`
    ]);
    const [volume, pdf] = (await komga.feed(`${sites.base}/opds/series/s1?page=2`)).entries;
    expect(volume).toMatchObject({
      title: '星降る町の配達人 第3巻',
      authors: '架空 作者',
      file: { href: `${sites.base}/opds/files/s1-3.epub`, ext: 'epub' }
    });
    expect(opds.isItem(volume)).toBe(true);
    expect(opds.isItem(pdf)).toBe(false);
    const comic = (await komga.feed(`${sites.base}/opds/series/s2`)).entries[0];
    expect(comic.file?.ext).toBe('cbz');
    expect(comic.pages).toEqual({ href: `${sites.base}/opds/pages/s2-1/{pageNumber}`, count: 3 });
    expect((await komga.searchUrl('星')).startsWith(`${sites.base}/opds/`)).toBe(true);
  });

  it('reads every page of a series and its whole files', async () => {
    const komga = server(`${sites.base}/opds/catalog`);
    const work = await komga.details('/opds/series/s1');
    expect([work.mode, work.kind, work.chapters]).toEqual(['files', 'novel', 3]);
    const first = await komga.chapter(1, work);
    expect('file' in first && first.file.size).toBeGreaterThan(0);
    const broken = await komga.details('/opds/series/s3');
    await expect(komga.chapter(1, broken)).rejects.toThrow(/isn't a EPUB/);
  });

  it("reads Suwayomi's pages behind each chapter's metadata entry", async () => {
    const suwayomi = server(`${sites.base}/suwayomi`, 'suwayomi');
    const key = opds.workKey('suwayomi', `${suwayomi.root}/series/7/chapters`);
    expect(key).toBe('/suwayomi/api/opds/v1.2/series/7/chapters?sort=number_asc');
    const work = await suwayomi.details(key);
    expect([work.mode, work.kind, work.chapters]).toEqual(['pages', 'manga', 12]);
    const chapter = await suwayomi.chapter(3, work);
    expect('pages' in chapter && chapter.pages.map((p) => p.type)).toEqual([
      'image/png',
      'image/png'
    ]);
  });

  it('refuses what is not a catalog, and links to other servers', async () => {
    for (const broken of [
      '<feed><unclosed>',
      '',
      '{"json": true}',
      '<html><body>hi</body></html>'
    ]) {
      expect(() => opds.parse(broken, sites.base), broken).toThrow(opds.NotCatalog);
    }
    expect(
      opds.parse(
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A &amp; B</title></feed>',
        sites.base
      ).title
    ).toBe('A & B');
    const komga = server(`${sites.base}/opds/catalog`);
    expect(() => komga.url('https://example.org/opds/series')).toThrow();
    await expect(komga.feed(`${sites.base}/opds/redirect`)).rejects.toThrow();
  });
});
