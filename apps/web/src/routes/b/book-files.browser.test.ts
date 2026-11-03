/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filter, firstValueFrom } from 'rxjs';
import { reactiveElements } from '$lib/components/book-reader/reactive-elements';
import { FuriganaStyle } from '$lib/data/furigana-style';
import { database, furiganaStyle$, hideFurigana$ } from '$lib/data/store';
import { ViewMode } from '$lib/data/view-mode';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';
import loadHtmlz from '$lib/functions/file-loaders/htmlz/load-htmlz';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';
import { recordKanjiText } from '$lib/data/words/kanji-seen';
import { knownKanjiMinCount } from '$lib/data/words/known-furigana';
import { addBook, mountReader, waitOnScreen } from './reader-fixture';

/*
 * Odd book files, from the file to the whole /b page in Chromium. What these catch:
 * - a bookmark at or past the book's end opening a blank page (one past the last section);
 * - a stylesheet the CSS parser refuses leaving the book stuck on load;
 * - book rules dropped because a class name contains "body"/"html", or the page's own html/body
 *   rules, line height or writing mode getting through when more rules are kept;
 * - an SVG <a> throwing in the link setup, which ends link, ruby and image handling;
 * - a delegated ruby listener toggling twice once a section change re-runs the setup;
 * - 130,000 rubies overflowing the argument limit;
 * - encoded hrefs, missing resources, empty or SVG chapters failing a whole import, while a missing
 *   chapter or a book with nothing in it must still fail, and scripts must still be removed;
 * - known furigana, SVG-only chapters and text only the sanitizer removes (see their tests);
 * - numeric titles turning into numbers or the file name, language ids being lost.
 */

// Known furigana loads this big table on opening: cold, it could outlast the test's wait.
await import('yurigana/kanji-readings.json');

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
  furiganaStyle$.next(FuriganaStyle.Partial);
  hideFurigana$.next(false);
});

const views = [ViewMode.Paginated, ViewMode.Continuous];
const writings = ['horizontal-tb', 'vertical-rl'] as const;
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

async function zip(files: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, text] of Object.entries(files)) {
    await writer.add(name, new TextReader(text));
  }
  return writer.close();
}

const chapter = (body: string) => `<html><head><title>c</title></head><body>${body}</body></html>`;

interface EpubFiles {
  metadata?: string;
  manifest: string;
  spine: string[];
  files: Record<string, string>;
}

async function epub({ metadata, manifest, spine, files }: EpubFiles) {
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${metadata ?? '<dc:title>t</dc:title><dc:language>ja</dc:language>'}</metadata><manifest>${manifest}</manifest><spine>${spine.map((id) => `<itemref idref="${id}"/>`).join('')}</spine></package>`;
  const blob = await zip({
    'META-INF/container.xml':
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': opf,
    ...Object.fromEntries(Object.entries(files).map(([name, text]) => [`OEBPS/${name}`, text]))
  });
  return loadEpub(new File([blob], 'file.epub'), document, 1);
}

const xhtml = (id: string, href: string) =>
  `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`;

async function htmlz(index: string, metadata = '') {
  const blob = await zip({
    'index.html': index,
    'metadata.opf': `<package><metadata xmlns:dc="x">${metadata}</metadata></package>`,
    'style.css': ''
  });
  return loadHtmlz(new File([blob], 'file.htmlz'), document, 1);
}

async function openHtml(
  elementHtml: string,
  styleSheet: string,
  view: ViewMode,
  writing: 'horizontal-tb' | 'vertical-rl'
) {
  const book = await database.upsertData(
    {
      title: `book-files-${Math.random()}`,
      styleSheet,
      elementHtml,
      blobs: {},
      hasThumb: false,
      characters: 100,
      sections: [],
      lastBookModified: Date.now(),
      lastBookOpen: Date.now()
    } as any,
    ReplicationSaveBehavior.Overwrite
  );
  component = await mountReader(book.id, view, writing);
}

const section = (id: string, body: string) =>
  `<div id="${id}"><div class="ttu-book-html-wrapper"><div class="ttu-book-body-wrapper">${body}</div></div></div>`;

describe('/b opens a bookmark at the end of the book on its last page', () => {
  for (const view of views) {
    for (const writing of writings) {
      for (const past of [0, 50]) {
        it(`${view}, ${writing}, ${past} past the end`, async () => {
          const id = await addBook(3, 41);
          const bookmark = (await database.getBookmark(id))!;
          await database.putBookmark({
            ...bookmark,
            exploredCharCount: bookmark.exploredCharCount! + past
          });
          component = await mountReader(id, view, writing);
          await waitOnScreen('p-3-40');
        }, 20_000);
      }
    }
  }
});

describe('/b with a stylesheet the CSS parser refuses', () => {
  // One broken rule, or a comment left open, must cost only itself.
  it('keeps the rules around a broken one', async () => {
    await openHtml(
      section('ttu-a', '<p id="p-1-1" class="a">本文</p><p id="p-1-2" class="b">本文</p>'),
      '.a{color:rgb(1,2,3)} .x{a:b;c} .b{color:rgb(4,5,6)} /* open',
      ViewMode.Paginated,
      'vertical-rl'
    );
    await waitOnScreen('p-1-1');
    expect(getComputedStyle(document.getElementById('p-1-1')!).color).toBe('rgb(1, 2, 3)');
    expect(getComputedStyle(document.getElementById('p-1-2')!).color).toBe('rgb(4, 5, 6)');
  });

  for (const css of ['p{a:b;c}', 'p{color:red']) {
    it(`opens the book: ${css}`, async () => {
      await openHtml(
        section('ttu-a', '<p id="p-1-1">本文</p>'),
        css,
        ViewMode.Paginated,
        'vertical-rl'
      );
      await waitOnScreen('p-1-1');
    });
  }
});

describe('/b book CSS', () => {
  const sheet = `
    .body-text { color: rgb(1, 2, 3); line-height: 9; text-indent: 5em; writing-mode: horizontal-tb; }
    .html-x { color: rgb(4, 5, 6); }
    tbody td { color: rgb(7, 8, 9); }
    body p, html > body .gone, BODY.a p { color: rgb(10, 11, 12); }
    body { background-color: rgb(13, 14, 15); }`;

  for (const view of views) {
    for (const writing of writings) {
      it(`keeps class rules and drops the page's own, ${view}, ${writing}`, async () => {
        await openHtml(
          section(
            'ttu-a',
            '<p id="p-1-1" class="body-text">本文</p><p id="p-1-2" class="html-x">本文</p><p id="p-1-3">本文</p><table><tbody><tr><td id="td">本文</td></tr></tbody></table>'
          ),
          sheet,
          view,
          writing
        );
        await waitOnScreen('p-1-1');
        const style = (id: string) => getComputedStyle(document.getElementById(id)!);

        expect(style('p-1-1').color).toBe('rgb(1, 2, 3)');
        expect(style('p-1-2').color).toBe('rgb(4, 5, 6)');
        expect(style('td').color).toBe('rgb(7, 8, 9)');
        expect(style('p-1-3').color).not.toBe('rgb(10, 11, 12)');
        expect(getComputedStyle(document.body).backgroundColor).not.toBe('rgb(13, 14, 15)');
        // The reader's direction and its own line height win.
        expect(style('p-1-1').writingMode).toBe(writing);
        expect(style('p-1-1').lineHeight).not.toBe(`${parseFloat(style('p-1-1').fontSize) * 9}px`);
        expect(style('p-1-1').textIndent).toBe('0px');
      });
    }
  }
});

const linkBook =
  section(
    'ttu-a',
    `<p id="p-1-1"><a id="link" href="#ttu-b">次へ</a> <ruby id="ruby-a">漢字<rt>かんじ</rt></ruby></p>
     <svg width="100" height="20"><a id="svg-link" href="https://example.com/" xlink:href="https://example.com/"><text y="10">x</text></a></svg>
     <map name="m"><area id="area" href="https://example.com/" shape="rect" coords="0,0,1,1"></map>`
  ) + section('ttu-b', '<p id="p-2-1"><ruby id="ruby-b">漢字<rt>かんじ</rt></ruby>本文</p>');

describe('/b links and furigana', () => {
  for (const view of views) {
    for (const writing of writings) {
      it(`survive an SVG link, and toggle once per tap after a section change, ${view}, ${writing}`, async () => {
        furiganaStyle$.next(FuriganaStyle.Toggle);
        await openHtml(linkBook, '', view, writing);
        await waitOnScreen('p-1-1');
        await settle();

        const svgLink = document.getElementById('svg-link')!;
        expect(svgLink.hasAttribute('href')).toBe(false);
        expect(svgLink.hasAttribute('xlink:href')).toBe(false);
        expect(document.getElementById('area')!.hasAttribute('href')).toBe(false);

        const rubyA = document.getElementById('ruby-a')!;
        rubyA.click();
        expect(rubyA.classList.contains('reveal-rt')).toBe(true);
        rubyA.click();
        expect(rubyA.classList.contains('reveal-rt')).toBe(false);

        const jump = firstValueFrom(nextChapter$.pipe(filter((id) => id === 'ttu-b')));
        document.getElementById('link')!.click();
        await jump;
        await waitOnScreen('p-2-1');
        await settle();

        const rubyB = document.getElementById('ruby-b')!;
        rubyB.click();
        expect(rubyB.classList.contains('reveal-rt')).toBe(true);
        rubyB.click();
        expect(rubyB.classList.contains('reveal-rt')).toBe(false);
      }, 20_000);
    }
  }

  /*
   * Known furigana, on the real page with a kanji record. Bugs: all ruby toggling (not just the
   * known); a tap on other ruby swallowed, so a link around it dies; a known ruby's tap in a link
   * also jumping; a later section's ruby not marked (the marks run per section).
   */
  for (const view of views) {
    for (const writing of writings) {
      it(`known furigana: only known ruby toggles, ${view}, ${writing}`, async () => {
        await recordKanjiText('another book', '人間'.repeat(knownKanjiMinCount), 100);
        hideFurigana$.next(true);
        furiganaStyle$.next(FuriganaStyle.Known);
        await openHtml(
          section(
            'ttu-a',
            `<p id="p-1-1"><a href="#ttu-c"><ruby id="known">人間<rt>にんげん</rt></ruby></a>
             <a href="#ttu-b"><ruby id="other">学校<rt>がっこう</rt></ruby></a></p>`
          ) +
            section('ttu-b', '<p id="p-2-1"><ruby id="known-b">人間<rt>にんげん</rt></ruby></p>') +
            section('ttu-c', '<p id="p-3-1">本文</p>'),
          '',
          view,
          writing
        );
        await waitOnScreen('p-1-1');
        const shown = (id: string) =>
          getComputedStyle(document.querySelector(`#${id} rt`)!).visibility === 'visible';
        const jumps: string[] = [];
        const jumping = nextChapter$.subscribe((id) => jumps.push(id));

        try {
          await vi.waitFor(() => expect(shown('known')).toBe(false), 10_000);
          expect(shown('other')).toBe(true);

          document.getElementById('known')!.click();
          expect(shown('known')).toBe(true);
          document.getElementById('known')!.click();
          expect(shown('known')).toBe(false);
          expect(jumps.filter(Boolean)).toEqual([]);

          document.getElementById('other')!.click();
          expect(shown('other')).toBe(true);
          expect(jumps.filter(Boolean)).toEqual(['ttu-b']);

          await waitOnScreen('p-2-1');
          await vi.waitFor(() => expect(shown('known-b')).toBe(false), 10_000);
          document.getElementById('known-b')!.click();
          expect(shown('known-b')).toBe(true);
        } finally {
          jumping.unsubscribe();
        }
      }, 20_000);
    }
  }

  it('a tap on revealed partial furigana falls through to the page, as before', async () => {
    const content = document.createElement('div');
    content.innerHTML = '<ruby>漢字<rt>かんじ</rt></ruby>';
    document.body.append(content);
    const page = vi.fn();
    document.body.addEventListener('click', page);
    const ruby = content.querySelector('ruby')!;
    const sub = reactiveElements(
      document,
      FuriganaStyle.Partial,
      false,
      false
    )(content).subscribe();

    ruby.click();
    expect(ruby.classList.contains('reveal-rt')).toBe(true);
    expect(page).not.toHaveBeenCalled();
    ruby.click();
    expect(page).toHaveBeenCalledTimes(1);

    sub.unsubscribe();
    document.body.removeEventListener('click', page);
  });

  it('130,000 rubies keep working', async () => {
    const content = document.createElement('div');
    content.innerHTML =
      '<a id="link" href="#x">次</a>' + '<ruby>字<rt>じ</rt></ruby>'.repeat(130_000);
    const sub = reactiveElements(document, FuriganaStyle.Toggle, false, false)(content).subscribe();
    const ruby = content.querySelectorAll('ruby')[129_999] as HTMLElement;

    ruby.click();
    expect(ruby.classList.contains('reveal-rt')).toBe(true);
    sub.unsubscribe();
  }, 60_000);
});

describe('EPUB import', () => {
  it('finds URL-encoded items, whether the zip name is encoded or not', async () => {
    const book = await epub({
      manifest: xhtml('a', 'ch%201.xhtml') + xhtml('b', 'ch%202.xhtml'),
      spine: ['a', 'b'],
      files: { 'ch 1.xhtml': chapter('<p>一章</p>'), 'ch%202.xhtml': chapter('<p>二章</p>') }
    });

    expect(book.elementHtml).toContain('一章');
    expect(book.elementHtml).toContain('二章');
  });

  it('an href that is not valid percent-encoding is looked up as written', async () => {
    const book = await epub({
      manifest: xhtml('a', '100%.xhtml') + '<item id="f" href="50%.otf" media-type="font/otf"/>',
      spine: ['a'],
      files: { '100%.xhtml': chapter('<p>本文</p>') }
    });

    expect(book.elementHtml).toContain('本文');
  });

  it('skips missing fonts and stylesheets', async () => {
    const book = await epub({
      manifest:
        xhtml('a', 'a.xhtml') +
        '<item id="f" href="gone.otf" media-type="font/otf"/>' +
        '<item id="c" href="gone.css" media-type="text/css"/>' +
        '<item id="d" href="here.css" media-type="text/css"/>',
      spine: ['a'],
      files: { 'a.xhtml': chapter('<p>本文</p>'), 'here.css': 'p { color: red; }' }
    });

    expect(book.elementHtml).toContain('本文');
    expect(book.styleSheet).toBe('p { color: red; }');
  });

  it('still refuses a book whose chapter file is missing', async () => {
    await expect(
      epub({
        manifest: xhtml('a', 'a.xhtml') + xhtml('b', 'gone.xhtml'),
        spine: ['a', 'b'],
        files: { 'a.xhtml': chapter('<p>本文</p>') }
      })
    ).rejects.toThrow('gone.xhtml');
  });

  it('still refuses a book with nothing in it', async () => {
    await expect(
      epub({
        manifest: xhtml('a', 'a.xhtml'),
        spine: ['a'],
        files: { 'a.xhtml': chapter('') }
      })
    ).rejects.toThrow();
  });

  const toc = (...ids: string[]) =>
    `<ncx><navMap>${ids.map((id) => `<navPoint><navLabel><text>${id}</text></navLabel><content src="${id}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`;

  it('an empty chapter is an empty chapter, with contents around it', async () => {
    const book = await epub({
      manifest:
        xhtml('a', 'a.xhtml') +
        xhtml('b', 'b.xhtml') +
        xhtml('c', 'c.xhtml') +
        '<item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      spine: ['a', 'b', 'c'],
      files: {
        'a.xhtml': chapter('<p>一章</p>'),
        'b.xhtml': chapter(''),
        'c.xhtml': chapter('<p>三章</p>'),
        'toc.ncx': toc('a', 'b', 'c')
      }
    });

    expect(book.characters).toBe(4);
    expect(book.sections?.map((s) => s.reference)).toEqual(['ttu-a', 'ttu-b', 'ttu-c']);
    expect(book.sections?.map((s) => s.startCharacter)).toEqual([0, 2, 2]);
  });

  it('an empty chapter beside a script: the script is still removed', async () => {
    const book = await epub({
      manifest: xhtml('a', 'a%20b.xhtml') + xhtml('b', 'b.xhtml'),
      spine: ['a', 'b'],
      files: {
        'a b.xhtml': chapter('<p onclick="alert(1)">一章<script>alert(1)</script></p>'),
        'b.xhtml': chapter('')
      }
    });

    expect(book.elementHtml).toContain('一章');
    expect(book.elementHtml).not.toContain('<script');
    expect(book.elementHtml).not.toContain('onclick');
  });

  it('an SVG first chapter (a cover page) does not fail the book or its contents', async () => {
    const book = await epub({
      manifest:
        '<item id="cover" href="cover.svg" media-type="image/svg+xml"/>' +
        xhtml('a', 'a.xhtml') +
        '<item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      spine: ['cover', 'a'],
      files: {
        'cover.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
        'a.xhtml': chapter('<p>本文</p>'),
        'toc.ncx': toc('a')
      }
    });

    expect(book.characters).toBe(2);
    expect(book.sections?.map((s) => s.reference)).toEqual(['ttu-cover', 'ttu-a']);
  });

  // Places are counted in the cleaned book: anything more in `characters` puts the book's end, its
  // chapters and its percentage off from what the reader shows.
  it('counts what the reader shows: no script or form text', async () => {
    const book = await epub({
      manifest: xhtml('a', 'a.xhtml'),
      spine: ['a'],
      files: {
        'a.xhtml': chapter('<script>var 文字列 = "長い";</script><form>入力欄</form><p>本文</p>')
      }
    });

    expect(book.characters).toBe(2);
  });

  // Blank page where the book's picture belongs: the chapter imported empty.
  for (const view of views) {
    it(`shows an SVG-only chapter as its picture, ${view}`, async () => {
      const book = await epub({
        manifest: '<item id="cover" href="pics/cover.svg" media-type="image/svg+xml"/>',
        spine: ['cover'],
        files: {
          'pics/cover.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400"/></svg>'
        }
      });
      const { id } = await database.upsertData(
        { ...book, title: `svg-${Math.random()}` } as any,
        ReplicationSaveBehavior.Overwrite
      );

      component = await mountReader(id, view, 'vertical-rl');
      await vi.waitFor(() => {
        const image = document.querySelector<HTMLImageElement>('#ttu-cover img');

        expect(image?.complete && image.naturalWidth).toBe(300);
      }, 10_000);
    }, 20_000);
  }

  it('keeps numeric titles as text and reads languages with an id', async () => {
    const files = { 'a.xhtml': chapter('<p>本文</p>') };
    const open = (metadata: string) =>
      epub({ metadata, manifest: xhtml('a', 'a.xhtml'), spine: ['a'], files });

    expect(await open('<dc:title>1984</dc:title>')).toMatchObject({ title: '1984' });
    expect(await open('<dc:title id="t">007</dc:title>')).toMatchObject({ title: '007' });
    expect(await open('<dc:title>true</dc:title>')).toMatchObject({ title: 'true' });
    expect(
      await open('<dc:title>t</dc:title><dc:language id="l"> en </dc:language>')
    ).toMatchObject({ language: 'en' });
  });
});

describe('HTMLZ import', () => {
  // Places are counted in the cleaned book: anything more in `characters` puts the book's end, its
  // chapters and its percentage off from what the reader shows.
  it('counts what the reader shows: no script or form text', async () => {
    const book = await epub({
      manifest: xhtml('a', 'a.xhtml'),
      spine: ['a'],
      files: {
        'a.xhtml': chapter('<script>var 文字列 = "長い";</script><form>入力欄</form><p>本文</p>')
      }
    });

    expect(book.characters).toBe(2);
  });

  // Blank page where the book's picture belongs: the chapter imported empty.
  for (const view of views) {
    it(`shows an SVG-only chapter as its picture, ${view}`, async () => {
      const book = await epub({
        manifest: '<item id="cover" href="pics/cover.svg" media-type="image/svg+xml"/>',
        spine: ['cover'],
        files: {
          'pics/cover.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400"/></svg>'
        }
      });
      const { id } = await database.upsertData(
        { ...book, title: `svg-${Math.random()}` } as any,
        ReplicationSaveBehavior.Overwrite
      );

      component = await mountReader(id, view, 'vertical-rl');
      await vi.waitFor(() => {
        const image = document.querySelector<HTMLImageElement>('#ttu-cover img');

        expect(image?.complete && image.naturalWidth).toBe(300);
      }, 10_000);
    }, 20_000);
  }

  it('keeps numeric titles as text, and takes the first of two', async () => {
    const body = '<html><body><p>本文</p></body></html>';

    expect(await htmlz(body, '<dc:title>1984</dc:title>')).toMatchObject({ title: '1984' });
    expect(await htmlz(body, '<dc:title>1984</dc:title><dc:title>Other</dc:title>')).toMatchObject({
      title: '1984'
    });
    expect(await htmlz(body)).toMatchObject({ title: 'file.htmlz' });
  });

  it('a file with no body fails at once with a clear error', async () => {
    const started = performance.now();

    await expect(htmlz(`<html><body>${' '.repeat(40)}`)).rejects.toThrow(/body/);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('reads an empty body and a large one', async () => {
    expect(await htmlz('<html><body></body></html>')).toMatchObject({ elementHtml: '' });
    const big = await htmlz(`<html><body>${'あ\n'.repeat(5_000_000)}</body></html>`);
    expect(big.elementHtml.length).toBe(10_000_000);
  }, 60_000);
});
