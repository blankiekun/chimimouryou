/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import manga from '../../../../../../server/tests/fixtures/sources/extensions/manga.js?raw';
import novel from '../../../../../../server/tests/fixtures/sources/extensions/novel.js?raw';
import {
  ExtensionError,
  openExtension,
  sandboxPage,
  type ExtensionRuntime
} from './extension-runtime';
import { NeedsAppError, pacing } from './transport';

/*
 * Source extensions end to end in real Chromium: the jail and sandbox frames, QuickJS, the bridge,
 * transport.ts and the fake sites (serve.py, through extension-probes/servers.ts). Ways it can fail:
 * - The frame or QuickJS doesn't start; a Mangayomi-format extension (manga: page images; novel:
 *   chapter HTML) gets wrong or missing data through Client/Document/MProvider/parseDates.
 * - The app fetches for the extension what it shouldn't: an undeclared host, http, POST, more than
 *   100 requests in a call, an image from a host no result named, a non-image as an image.
 * - A result of the wrong shape reaches the app; a refused Referer isn't "needs the app".
 * - An endless loop or memory bomb stalls the app longer than a slice, or kills the runtime; a
 *   frame that stops answering stays, or takes other extension frames' calls with it unnoticed.
 * - As if QuickJS broke (extension-probes/frame-probes.js runs in the real frame): any request to
 *   another origin, UDP (WebRTC), a self-navigation to another site, the app's storage, cookies or
 *   window within reach, or a same-origin request carrying the app's cookies.
 * Each run's probe results and sink log go to node_modules/.vitest/source-sandbox-probes-<browser>.json
 * (servers.ts) as its record; the assertions are what must hold.
 */

interface Hit {
  kind: string;
  path?: string;
  cookie?: string;
}
let config: { fixture: string; sink: string; udpPort: number };
const hits = async (): Promise<Hit[]> => (await fetch('/__probes/hits')).json();
const leaks = (all: Hit[]) =>
  all.filter(
    (hit) =>
      hit.kind === 'request' || hit.kind === 'udp' || (hit.kind === 'same-origin' && hit.cookie)
  );
const record: Record<string, unknown> = { browser: navigator.userAgent };

const kakuyomu = { name: 'Fixture manga', baseUrl: 'https://kakuyomu.jp', apiUrl: '', itemType: 0 };
const syosetu = {
  name: 'Fixture novel',
  baseUrl: 'https://ncode.syosetu.com',
  apiUrl: 'https://api.syosetu.com',
  itemType: 2
};

beforeAll(async () => {
  config = await (await fetch('/__probes/config')).json();
  vi.stubEnv('VITE_SOURCES_FIXTURE_URL', config.fixture);
  pacing.site = 0;
  // A same-origin request the frame makes must not carry this. SameSite=Strict like the app's own
  // session cookies (server/account/service.py): the frame is another site. (Firefox does send
  // a cookie without SameSite along with the frame's same-origin script requests.)
  document.cookie = 'probe-app-session=secret; path=/; SameSite=Strict';
});

afterAll(() => {
  document.body.innerHTML = '';
});

describe('a fixture extension through the bridge', () => {
  it('manga: lists, details and page images, the CDN learned from its results', async () => {
    const runtime = await openExtension(manga, kakuyomu);
    const popular = await runtime.popular(1);
    expect(popular.list.map((work) => work.link)).toEqual([
      'https://kakuyomu.jp/works/1177354054000000001',
      'https://kakuyomu.jp/works/1177354054000000002'
    ]);
    // Not yet named by a result: refused.
    await expect(runtime.image('https://cdn.kdkw.jp/page/0.png')).rejects.toThrow(/Not a host/);
    const detail = await runtime.detail(popular.list[0].link);
    expect(detail.author).toBe('試験書き手');
    expect(detail.chapters.length).toBeGreaterThan(50);
    expect(Number(detail.chapters.at(-1)?.dateUpload)).toBe(Date.parse('2026-09-02T15:30:00.000Z'));

    const pages = await runtime.pages(detail.chapters[0].url);
    expect(pages).toHaveLength(4);
    expect(pages[0]).toEqual({
      url: 'https://cdn.kdkw.jp/page/0.png',
      headers: { Referer: 'https://kakuyomu.jp', 'User-Agent': 'Mozilla/5.0 fixture' }
    });
    expect([...runtime.imageHosts]).toContain('cdn.kdkw.jp');
    const image = await runtime.image(pages[0].url, pages[0].headers);
    expect(image.type).toBe('image/png');
    expect(new Uint8Array(image.body).slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    // The CDN host answers HTML here: an image host serves images only.
    await expect(runtime.image('https://cdn.kdkw.jp/page/0.html')).rejects.toThrow(
      /didn't send an image/
    );
    runtime.close();
  });

  it('novel: JSON API lists, details and chapter HTML', async () => {
    const runtime = await openExtension(novel, syosetu);
    const popular = await runtime.popular(1);
    expect(popular).toEqual({
      list: [
        {
          name: '春の手紙　～試験の物語～',
          imageUrl: '',
          link: 'https://ncode.syosetu.com/n0001aa/'
        },
        { name: '秋の&日記', imageUrl: '', link: 'https://ncode.syosetu.com/n0003cc/' }
      ],
      hasNextPage: true
    });
    const detail = await runtime.detail(popular.list[0].link);
    expect(detail.name).toBe('春の手紙　～試験の物語～');
    expect(detail.author).toBe('試験作者');
    expect(detail.chapters[0]).toMatchObject({
      name: '第百三話　手紙の&返事',
      url: 'https://ncode.syosetu.com/n0001aa/103/'
    });
    const html = await runtime.html(detail.chapters[0].name, detail.chapters[0].url);
    expect(html).toContain('<rt>しょうじょ</rt>');
    expect(html).toContain('前書き');
    runtime.close();
  });
});

// Inside QuickJS: what an extension sees and what the app does with its requests and answers.
// getHtmlContent(name, url) runs probe `name`, since it may answer any text.
const hostile = `
class DefaultExtension extends MProvider {
  async getHtmlContent(name, arg) { return JSON.stringify(await this[name](arg)); }
  globals() {
    return ['fetch', 'XMLHttpRequest', 'WebSocket', 'document', 'window', 'location', 'indexedDB', 'localStorage',
      'navigator', 'postMessage', 'RTCPeerConnection', 'importScripts', 'setTimeout', 'DOMParser']
      .filter((name) => typeof globalThis[name] !== 'undefined');
  }
  async request([method, url]) {
    try {
      const res = method === 'POST' ? await new Client().post(url, {}, 'x') : await new Client().get(url, { Cookie: 'a=b' });
      return 'fetched ' + res.statusCode;
    } catch (e) { return 'refused: ' + e.message; }
  }
  async many() {
    for (let i = 0; i < 101; i += 1) await new Client().get('https://kakuyomu.jp/search?q=' + i);
    return 'all';
  }
  spin() { while (true) {} }
  async spinLater() { await new Client().get('https://kakuyomu.jp/search?q=x'); while (true) {} }
  eat() { const a = []; while (true) a.push(new Array(1e5).fill(1)); }
  ok() { return 'still here'; }
  getPopular() { return { list: 'not a list' }; }
  getDetail() { return { name: 'ok', chapters: [{ name: 'no url' }, { url: 'https://kakuyomu.jp/e/1', name: 7 }], genre: [1, 'g'] }; }
  getPageList() { return ['https://kakuyomu.jp/p.png', { url: 'http://plain.example/p.png', headers: { Cookie: 'x', Referer: 'r' } }]; }
}`;

describe('a hostile extension inside QuickJS', () => {
  let runtime: ExtensionRuntime;
  const probe = async (name: string, arg: unknown = null) =>
    JSON.parse(await runtime.html(name, arg as string));
  beforeAll(async () => {
    runtime = await openExtension(hostile, kakuyomu);
  });
  afterAll(() => runtime.close());

  it('sees nothing of the browser', async () => {
    expect(await probe('globals')).toEqual([]);
  });

  it('gets only GETs over https to its declared hosts, never with its Cookie header', async () => {
    const before = (await hits()).length;
    expect(await probe('request', ['GET', `${config.sink}/bridge`])).toMatch(
      /^refused: Not a host/
    );
    expect(await probe('request', ['GET', 'http://kakuyomu.jp/search'])).toMatch(
      /^refused: Not a host/
    );
    expect(await probe('request', ['GET', 'https://evil.example/x'])).toMatch(
      /^refused: Not a host/
    );
    expect(await probe('request', ['POST', 'https://kakuyomu.jp/search'])).toMatch(
      /^refused: POST/
    );
    expect(await probe('request', ['GET', 'https://kakuyomu.jp/search?q=a'])).toBe('fetched 200');
    expect(await probe('request', ['GET', 'https://kakuyomu.jp/missing'])).toBe('fetched 404');
    await expect(probe('many')).rejects.toThrow(/More than 100 requests/);
    expect(leaks((await hits()).slice(before))).toEqual([]);
  }, 30_000);

  it('answers of the wrong shape never reach the app as they are', async () => {
    await expect(runtime.popular(1)).rejects.toThrow(ExtensionError);
    expect(await runtime.detail('https://kakuyomu.jp/works/1')).toMatchObject({
      name: 'ok',
      genre: ['1', 'g'],
      chapters: [{ name: '7', url: 'https://kakuyomu.jp/e/1', dateUpload: '', scanlator: '' }]
    });
    expect(await runtime.pages('https://kakuyomu.jp/e/1')).toEqual([
      { url: 'https://kakuyomu.jp/p.png', headers: {} },
      { url: 'http://plain.example/p.png', headers: { Referer: 'r' } }
    ]);
    // http image URLs never become image hosts.
    expect([...runtime.imageHosts]).toEqual(['kakuyomu.jp']);
  });

  it('an endless loop or a memory bomb stalls the app one slice at most, and the runtime goes on', async () => {
    let maxGap = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    const timed = async (name: string, error: RegExp) => {
      maxGap = 0;
      const started = performance.now();
      await expect(probe(name)).rejects.toThrow(error);
      return {
        callMs: Math.round(performance.now() - started),
        appMaxTimerGapMs: Math.round(maxGap)
      };
    };
    const loops = {
      spin: await timed('spin', /interrupted/),
      spinLater: await timed('spinLater', /interrupted/),
      memoryBomb: await timed('eat', /out of memory|interrupted/)
    };
    clearInterval(ticker);
    record.loops = loops;
    // 500 ms slices: where the frame shares the app's thread (Firefox) the app stalls that long.
    expect(loops.spin.appMaxTimerGapMs).toBeLessThan(900);
    expect(loops.spinLater.appMaxTimerGapMs).toBeLessThan(900);
    // Not bounded by the slice: QuickJS doesn't check for interrupts while it collects garbage at
    // its memory limit (2.3 s here in Firefox, 13 s with 1 MB strings). Recorded, not asserted.
    expect(await probe('ok')).toBe('still here');
  }, 60_000);
});

describe('a plain browser and Referer', () => {
  it('an image refused without its Referer is "needs the desktop app", not a failure', async () => {
    const runtime = await openExtension(manga, kakuyomu);
    const [page] = await runtime.pages(
      'https://kakuyomu.jp/works/1177354054000000001/episodes/1177354054000200001'
    );
    // The fake CDN answers 403 under referer/ without the work site's Referer, which fetch() can't send.
    const guarded = page.url.replace('/page/', '/referer/');
    await expect(runtime.image(guarded, page.headers)).rejects.toThrow(NeedsAppError);
    // A Referer was dropped here too, but only 401/403 mean the site wanted it.
    await expect(runtime.image('https://kakuyomu.jp/none.png', page.headers)).rejects.toThrow(
      /answered 404/
    );
    runtime.close();
  });
});

describe('if extension code broke out of QuickJS', () => {
  const frameMessages: unknown[] = [];
  const onMessage = (event: MessageEvent) => {
    if (event.data?.probes) frameMessages.push(event.data.probes);
  };
  beforeAll(() => addEventListener('message', onMessage));
  afterAll(() => {
    removeEventListener('message', onMessage);
    sandboxPage.path = 'source-sandbox.html';
  });
  const idle = 'class DefaultExtension extends MProvider {}';

  it('nothing leaves the frame and nothing of the app is in reach', async () => {
    const before = (await hits()).length;
    sandboxPage.path = 'source-sandbox-probe.html';
    const runtime = await openExtension(idle, kakuyomu);
    await vi.waitFor(() => expect(frameMessages.length).toBe(1), {
      timeout: 20_000,
      interval: 100
    });
    // Late requests (prefetch, workers) still count.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    runtime.close();
    const results = frameMessages[0] as {
      mustBlock: Record<string, string>;
      network: Record<string, string>;
    };
    const after = (await hits()).slice(before);
    record.probes = results;
    record.probeHits = after;
    expect(
      Object.entries(results.mustBlock).filter(([, result]) => !result.startsWith('blocked'))
    ).toEqual([]);
    expect(leaks(after)).toEqual([]);
  }, 40_000);

  const navigations: Record<string, Hit[]> = {};
  record.navigations = navigations;
  for (const nav of ['location', 'anchor', 'metaRefresh', 'blob', 'data', 'javascript']) {
    it(`a self-navigation (${nav}) goes nowhere`, async () => {
      const before = (await hits()).length;
      sandboxPage.path = `source-sandbox-probe.html?nav=${nav}`;
      // The host stops a frame that navigates (it says so on pagehide, or loads again).
      const runtime = await openExtension(idle, kakuyomu).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      runtime?.close();
      const after = (await hits()).slice(before);
      navigations[nav] = after;
      expect(leaks(after)).toEqual([]);
    }, 20_000);
  }
});

afterAll(async () => {
  record.allHits = await hits();
  await fetch('/__probes/record', { method: 'POST', body: JSON.stringify(record, null, 2) });
});
