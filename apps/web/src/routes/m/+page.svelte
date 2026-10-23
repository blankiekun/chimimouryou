<script lang="ts">
  /**
   * Manga reader (CBZ/ZIP, not part of upstream), modeled on Mihon/Tachiyomi: one page or a
   * two-page spread at a time (right to left or left to right) or a vertical strip; tap the
   * middle for the menu. Paged modes handle their own gestures: swipes drag the page along,
   * pinch, double tap and Ctrl+wheel zoom, and a zoomed page pans.
   * Book-only extras (highlights, recap, listen, search, statistics) are left out.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Fa from 'svelte-fa';
  import { faBookOpen, faEllipsis, faExpand, faSliders } from '@fortawesome/free-solid-svg-icons';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import {
    optionsForToggle,
    type ToggleOption
  } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import PlayerBar from '$lib/components/player-bar.svelte';
  import ReaderSheet from '$lib/components/book-reader/reader-sheet.svelte';
  import VolumeTransition from '$lib/components/manga/volume-transition.svelte';
  import MokuroOverlay from '$lib/components/manga/mokuro-overlay.svelte';
  import { calibreCoverUrl, loadCalibreCatalog, type CalibreBook } from '$lib/data/calibre';
  import { loadSeriesOverrides } from '$lib/data/series-overrides';
  import {
    loadMokuro,
    mangaText$,
    pagesText,
    type MangaText,
    type MokuroPage
  } from '$lib/data/mokuro';
  import {
    autoReplication$,
    cacheStorageData$,
    database,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    statisticsMergeMode$,
    syncTarget$
  } from '$lib/data/store';
  import { pagePath } from '$lib/data/env';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import { logger } from '$lib/data/logger';
  import {
    adjacentVolumes,
    seriesReadingMode,
    borderColor,
    clampPan,
    fitSize,
    mangaBackground$,
    mangaBookmark,
    mangaDoubleTapZoom$,
    mangaDualPage$,
    mangaKeepScreenOn$,
    mangaPageNumber$,
    mangaPages,
    mangaScale$,
    mangaTapInvert$,
    mangaTapLayout$,
    pageSpreads,
    tapDirection,
    type MangaBackground,
    type MangaDualPage,
    type MangaReadingMode,
    type MangaScale,
    type MangaTapInvert,
    type MangaTapLayout,
    type PageSize
  } from '$lib/data/manga';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
  import {
    StorageDataType,
    StorageKey,
    StorageSourceDefault
  } from '$lib/data/storage/storage-types';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { formatPageTitle } from '$lib/functions/format-page-title';

  const modes: ToggleOption<MangaReadingMode>[] = [
    { id: 'rtl', text: 'Right to left' },
    { id: 'ltr', text: 'Left to right' },
    { id: 'vertical', text: 'Vertical' }
  ];
  const tapLayouts: ToggleOption<MangaTapLayout>[] = [
    { id: 'default', text: 'Default' },
    { id: 'l', text: 'L shape' },
    { id: 'kindle', text: 'Kindle' },
    { id: 'edge', text: 'Edge' },
    { id: 'sides', text: 'Sides' },
    { id: 'off', text: 'Off' }
  ];
  const tapInverts: ToggleOption<MangaTapInvert>[] = [
    { id: 'none', text: 'None' },
    { id: 'horizontal', text: 'Horizontal' },
    { id: 'vertical', text: 'Vertical' },
    { id: 'both', text: 'Both' }
  ];
  const scales: ToggleOption<MangaScale>[] = [
    { id: 'screen', text: 'Screen' },
    { id: 'width', text: 'Width' },
    { id: 'height', text: 'Height' },
    { id: 'original', text: 'Original' },
    { id: 'smart', text: 'Smart' }
  ];
  const dualPages: ToggleOption<MangaDualPage>[] = [
    { id: 'auto', text: 'Auto' },
    { id: 'on', text: 'On' },
    { id: 'off', text: 'Off' }
  ];
  const textModes: ToggleOption<MangaText>[] = [
    { id: 'hover', text: 'Hover' },
    { id: 'always', text: 'Always' },
    { id: 'off', text: 'Off' }
  ];
  const backgrounds: ToggleOption<MangaBackground>[] = [
    { id: 'black', text: 'Black' },
    { id: 'gray', text: 'Gray' },
    { id: 'white', text: 'White' },
    { id: 'auto', text: 'Auto' }
  ];
  // The reader's backdrop is part of the page, not the theme.
  const backgroundColors = { black: '#000', gray: '#262626', white: '#fff' };
  const defaultSources: Record<string, StorageKey> = {
    [StorageSourceDefault.CALIBRE_DEFAULT]: StorageKey.CALIBRE,
    [StorageSourceDefault.GDRIVE_DEFAULT]: StorageKey.GDRIVE,
    [StorageSourceDefault.ONEDRIVE_DEFAULT]: StorageKey.ONEDRIVE
  };
  /** Until a page's size is known it is laid out as a typical portrait page. */
  const unknownSize = { width: 7, height: 10 };
  const turnMs = 200;
  const maxZoom = 5;
  const wakeLockSupported = browser && 'wakeLock' in navigator;

  let book: BooksDbBookData | undefined;
  let urls: string[] = [];
  let sizes: (PageSize | undefined)[] = [];
  let pageIndex = 0;
  let savedIndex = -1;
  /** Set once the saved position is known, so nothing is saved over it before. */
  let ready = false;
  let showMenu = false;
  let showSettings = false;
  let showMore = false;
  let shift = false;
  let loaded = new Set<number>();
  let strip: HTMLElement | undefined;
  let local: BrowserStorageHandler;
  let external: BaseStorageHandler | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerStart: { x: number; y: number } | undefined;
  let viewWidth = 0;
  let viewHeight = 0;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  /** Horizontal offset of the page track while a page is dragged or turning. */
  let dragX = 0;
  let animating = false;
  let autoBackground = '#000';
  let wakeLock: WakeLockSentinel | undefined;
  let volumes: { series?: string; previous?: CalibreBook; next?: CalibreBook } = {};
  /** This volume's catalog entry (Calibre manga), for its number */
  let currentVolume: CalibreBook | undefined;
  /** The card shown past the last (1) or before the first (-1) spread, else 0. */
  let transition = 0;
  let opening = false;
  let openError = '';
  let wantWakeLock = false;
  let requestingWakeLock = false;
  /** Each page's mokuro text, if the server has some for this volume. */
  let pageText: (MokuroPage | undefined)[] = [];

  $: readingMode = seriesReadingMode(volumes.series);
  $: mode = $readingMode;
  $: pageCount = urls.length;
  $: view = { width: viewWidth, height: viewHeight };
  $: dual = $mangaDualPage$ === 'on' || ($mangaDualPage$ === 'auto' && viewWidth > viewHeight);
  $: groups = pageSpreads(sizes, dual, shift);
  $: groupIndex = Math.max(
    0,
    groups.findIndex((group) => group.includes(pageIndex))
  );
  /**
   * The page a bookmark keeps: a spread's first, so another device or layout opens on it, but the
   * last spread's last page, so it counts as finished.
   */
  $: shownPage =
    mode === 'vertical'
      ? pageIndex
      : (groups[groupIndex]?.at(groupIndex === groups.length - 1 ? -1 : 0) ?? pageIndex);
  $: if (ready && shownPage !== savedIndex) scheduleSave();
  // Next is to the left in right-to-left manga.
  $: sign = mode === 'rtl' ? -1 : 1;
  $: base = groupSize(groupIndex, groups, sizes, $mangaScale$, view);
  $: content = { width: base.width * zoom, height: base.height * zoom };
  $: overflows = content.width > viewWidth + 1 || content.height > viewHeight + 1;
  $: resetView(groupIndex, base);
  $: slots = [-1, 0, 1]
    .map((offset) => groupIndex + offset)
    .filter((index) => mode !== 'vertical' && groups[index]);
  $: preload(groups, groupIndex);
  // Reactive so the template follows every value it reads.
  $: slotStyle = (index: number) => {
    const own = index === groupIndex;
    const size = own ? content : groupSize(index, groups, sizes, $mangaScale$, view);
    const at = own ? pan : startPan(size);
    const offset = (index - groupIndex) * viewWidth * sign + dragX;

    return (
      `transform: translate(${offset + at.x}px, ${at.y}px);` +
      `width: ${size.width}px; height: ${size.height}px;` +
      (animating ? `transition: transform ${turnMs}ms ease-out;` : '')
    );
  };
  $: background =
    $mangaBackground$ === 'auto' ? autoBackground : backgroundColors[$mangaBackground$];
  $: if ($mangaBackground$ === 'auto') sampleBackground(urls[groups[groupIndex]?.[0] ?? pageIndex]);
  $: scrollStripOnModeChange(mode);
  $: if (browser) updateWakeLock($mangaKeepScreenOn$);
  $: shownPages = mode === 'vertical' ? [pageIndex] : (groups[groupIndex] ?? [pageIndex]);
  $: pagesLabel = shownPages.map((index) => index + 1).join('–');
  $: volumeLabel = currentVolume?.seriesIndex != null ? `Vol. ${currentVolume.seriesIndex}` : '';
  $: barTitle = (volumeLabel && volumes.series) || book?.title || '';
  $: barPlace = [volumeLabel, pageCount ? `${pagesLabel} / ${pageCount}` : '']
    .filter(Boolean)
    .join(' · ');
  $: percent = pageCount ? Math.round(((shownPage + 1) / pageCount) * 100) : 0;
  /** Where the slider's thumb is, 0-100 from its start */
  $: sliderAt = pageCount > 1 ? (pageIndex / (pageCount - 1)) * 100 : 0;
  $: modeLabel = modes.find((option) => option.id === mode)?.text ?? '';
  $: hasText = pageText.some(Boolean);
  $: textLabel = textModes.find((option) => option.id === $mangaText$)?.text ?? '';
  $: moreItems = [
    volumes.previous && {
      label: `Previous volume: ${volumes.previous.title}`,
      volume: volumes.previous
    },
    volumes.next && { label: `Next volume: ${volumes.next.title}`, volume: volumes.next }
  ].filter(Boolean) as { label: string; volume: CalibreBook }[];

  function handler(type: StorageKey, name?: string, isForBrowser = true) {
    return getStorageHandler(
      window,
      type,
      name,
      isForBrowser,
      $cacheStorageData$,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$
    );
  }

  /** Where this book's progress syncs, as in the book reader (Calibre always syncs). */
  async function externalHandler(data: BooksDbBookData) {
    const name =
      data.storageSource || ($autoReplication$ !== AutoReplicationType.Off ? $syncTarget$ : '');

    if (!name) return undefined;

    const type =
      defaultSources[name] ?? (await (await database.db).get('storageSource', name))?.type;

    return type ? handler(type, name) : undefined;
  }

  function context() {
    return { id: book!.id, title: book!.title, imagePath: book!.coverImage };
  }

  /** Reads every page's size (for spreads and fitting) without keeping the images. */
  function measurePages() {
    const found: (PageSize | undefined)[] = new Array(urls.length);
    let queued = false;

    urls.forEach((url, index) => {
      const img = new Image();

      img.onload = () => {
        found[index] = { width: img.naturalWidth, height: img.naturalHeight };
        img.src = '';

        if (queued) return;

        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          sizes = [...found];
        });
      };
      img.src = url;
    });
  }

  async function load(id: number) {
    local = handler(StorageKey.BROWSER) as BrowserStorageHandler;
    local.startContext({ id, title: '' });

    const data = await local.getBook();

    if (!data) {
      goto(`${pagePath}/manage`);
      return;
    }

    book = data;
    local.startContext(context());
    urls = mangaPages(data).map((name) => URL.createObjectURL(data.blobs[name]));
    sizes = new Array(urls.length);
    measurePages();
    data.lastBookOpen = Date.now();
    await local.updateLastRead(data);

    try {
      external = await externalHandler(data);

      if (external) {
        external.startContext(context());

        if (
          external.storageType === StorageKey.CALIBRE ||
          $autoReplication$ === AutoReplicationType.Down ||
          $autoReplication$ === AutoReplicationType.All
        ) {
          const error = await replicateData(
            external,
            local,
            false,
            [context()],
            [StorageDataType.PROGRESS]
          );

          if (error) throw new Error(error);
        }

        await external.updateLastRead(data);
      }
    } catch (error: any) {
      // Reading works offline from the browser copy; progress syncs on the next save.
      logger.warn(`Manga sync failed: ${error.message}`);
    }

    const bookmark = await database.getBookmark(data.id);

    savedIndex = Math.min(bookmark?.exploredCharCount || 0, Math.max(pageCount - 1, 0));
    goToPage(savedIndex);
    ready = true;

    if (external?.storageType === StorageKey.CALIBRE) {
      loadVolumes(data.title).catch(({ message }) =>
        logger.warn(`Could not find the series' other volumes: ${message}`)
      );
      loadText(data).catch(({ message }) =>
        logger.warn(`Could not load the page text: ${message}`)
      );
    }
  }

  // shortcut: needs the catalog, so offline there are no volume links even for cached volumes.
  async function loadVolumes(title: string) {
    const [books, overrides] = await Promise.all([
      loadCalibreCatalog(),
      loadSeriesOverrides().catch(() => ({}))
    ]);

    volumes = adjacentVolumes(books, overrides, title);
    currentVolume = books.find((entry) => entry.title === title);
  }

  // shortcut: needs the catalog for the id, so there is no text offline; cache it in IndexedDB if missed.
  async function loadText(data: BooksDbBookData) {
    const calibreBook = (await loadCalibreCatalog()).find((entry) => entry.title === data.title);
    const text = calibreBook && (await loadMokuro(calibreBook.id));

    if (text) pageText = pagesText(text, mangaPages(data));
  }

  /** Opens another volume like the library does: downloaded and processed when first read. */
  async function openVolume(target: CalibreBook) {
    if (opening) return;

    opening = true;
    openError = '';

    try {
      await save();

      const calibre = handler(StorageKey.CALIBRE, '', false);

      calibre.startContext({ id: 0, title: target.title, imagePath: calibreCoverUrl(target) });

      const id = await calibre.prepareBookForReading();

      await database.putLastItem(id);
      await goto(`${pagePath}/b?id=${id}`);
    } catch (error: any) {
      // The handler is shared: progress saved from here must still go to this book.
      external?.startContext(context());
      openError = `Could not open ${target.title}: ${error.message}`;
      logger.warn(openError);
    } finally {
      opening = false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1000);
  }

  async function save() {
    clearTimeout(saveTimer);

    if (!ready || shownPage === savedIndex) return;

    savedIndex = shownPage;
    await database.putBookmark(mangaBookmark(book!.id, shownPage, pageCount));

    const upSync =
      external &&
      (external.storageType === StorageKey.CALIBRE ||
        $autoReplication$ === AutoReplicationType.Up ||
        $autoReplication$ === AutoReplicationType.All);

    if (upSync) {
      const error = await replicateData(
        local,
        external!,
        false,
        [context()],
        [StorageDataType.PROGRESS]
      ).catch((err: any) => err.message);

      if (error) logger.warn(`Manga progress sync failed: ${error}`);
    }
  }

  function goToPage(index: number) {
    transition = 0;
    pageIndex = Math.max(0, Math.min(pageCount - 1, index));

    if (mode === 'vertical') {
      strip?.querySelectorAll('img')[pageIndex]?.scrollIntoView();
    }
  }

  async function scrollStripOnModeChange(_mode: MangaReadingMode) {
    // The strip is rendered after the mode changes; keep the page.
    await tick();
    goToPage(pageIndex);
  }

  function onStripScroll() {
    if (!strip) return;

    const middle = strip.getBoundingClientRect().top + strip.clientHeight / 2;
    const pages = [...strip.querySelectorAll('img')];
    const index = pages.findIndex((img) => img.getBoundingClientRect().bottom > middle);

    pageIndex = index === -1 ? pages.length - 1 : index;
  }

  // ---- paged layout ----

  function groupSize(
    index: number,
    allGroups: number[][],
    allSizes: (PageSize | undefined)[],
    scale: MangaScale,
    viewSize: PageSize
  ) {
    const group = allGroups[index];

    if (!group || !viewSize.width) return { width: 0, height: 0 };

    return fitSize(
      scale,
      group.map((i) => allSizes[i] ?? unknownSize),
      viewSize
    );
  }

  /** Where a page starts: its top, and its right edge in right-to-left manga. */
  function startPan(size: PageSize) {
    return {
      x: clampPan(mode === 'rtl' ? -Infinity : 0, size.width, viewWidth),
      y: clampPan(0, size.height, viewHeight)
    };
  }

  let viewKey = '';

  /**
   * Back to the start of a spread when it changes or its pages are first measured; a resize (a phone
   * turning, its address bar hiding) keeps the zoom and position.
   */
  function resetView(index: number, size: PageSize, force = false) {
    const measured = groups[index]?.every((page) => sizes[page]);
    const key = `${index} ${measured} ${mode}`;

    if (key === viewKey && !force) {
      pan = {
        x: clampPan(pan.x, size.width * zoom, viewWidth),
        y: clampPan(pan.y, size.height * zoom, viewHeight)
      };
      return;
    }

    viewKey = key;
    zoom = 1;
    pan = startPan(size);
  }

  function setPan(x: number, y: number) {
    pan = {
      x: clampPan(x, base.width * zoom, viewWidth),
      y: clampPan(y, base.height * zoom, viewHeight)
    };
  }

  /** Zooms keeping the point (x, y) of the screen where it is. */
  function zoomAt(value: number, x: number, y: number) {
    const next = Math.max(1, Math.min(maxZoom, value));
    const ratio = next / zoom;

    zoom = next;
    setPan(x - (x - pan.x) * ratio, y - (y - pan.y) * ratio);
  }

  /** Decodes the pages a few spreads either way, so turning to them is instant. */
  const decoded = new Map<number, HTMLImageElement>();

  function preload(allGroups: number[][], index: number) {
    if (mode === 'vertical') return;

    const wanted = new Set(allGroups.slice(Math.max(0, index - 3), index + 4).flat());

    wanted.forEach((page) => {
      if (decoded.has(page) || !urls[page]) return;

      const img = new Image();

      img.src = urls[page];
      img.decode().catch(() => {});
      decoded.set(page, img);
    });
    decoded.forEach((_img, page) => {
      if (!wanted.has(page)) decoded.delete(page);
    });
  }

  let sampled = '';

  async function sampleBackground(url: string | undefined) {
    if (!url || url === sampled) return;

    sampled = url;

    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    img.src = url;
    await img.decode().catch(() => {});

    if (!ctx || sampled !== url || !img.naturalWidth) return;

    canvas.width = canvas.height = 16;
    ctx.drawImage(img, 0, 0, 16, 16);
    autoBackground = borderColor(ctx.getImageData(0, 0, 16, 16).data, 16);
  }

  // ---- turning ----

  let turnTimer: ReturnType<typeof setTimeout> | undefined;

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Turns by whole spreads (dir 1 forward), sliding the track along unless motion is reduced. Past
   * either end it shows the volume card, and turning on from there opens that volume.
   */
  function turn(dir: number) {
    const target = groups[groupIndex + dir];

    if (mode === 'vertical') {
      goToPage(pageIndex + dir);
      return;
    }

    if (transition) {
      const volume = transition > 0 ? volumes.next : volumes.previous;

      dragX = 0;

      if (dir !== transition) transition = 0;
      else if (volume) openVolume(volume);

      return;
    }

    if (turnTimer) return;

    if (!target) {
      // The start only has a card when there is a volume before.
      if (dir > 0 || volumes.previous) transition = dir;
      if (dragX) snapBack();

      return;
    }

    if (prefersReducedMotion()) {
      pageIndex = target[0];
      return;
    }

    animating = true;
    dragX = -dir * viewWidth * sign;
    turnTimer = setTimeout(() => {
      turnTimer = undefined;
      animating = false;
      dragX = 0;
      pageIndex = target[0];
    }, turnMs);
  }

  function snapBack() {
    animating = true;
    dragX = 0;
    turnTimer = setTimeout(() => {
      turnTimer = undefined;
      animating = false;
    }, turnMs);
  }

  // ---- gestures (paged modes) ----

  type Gesture =
    | { kind: 'pending' | 'pan' | 'swipe'; x: number; y: number; panX: number; panY: number }
    | {
        kind: 'pinch';
        distance: number;
        zoom: number;
        x: number;
        y: number;
        panX: number;
        panY: number;
      };

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | undefined;
  let lastTap: { x: number; y: number; time: number } | undefined;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWheelTurn = 0;

  function pinchState() {
    const [a, b] = [...pointers.values()];

    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function startDrag(x: number, y: number): Gesture {
    return { kind: 'pending', x, y, panX: pan.x, panY: pan.y };
  }

  /** Whether dragging by dx would move the page rather than push against its edge. */
  function canPanX(dx: number) {
    if (content.width <= viewWidth + 1) return false;

    return dx > 0 ? pan.x < -1 : pan.x > viewWidth - content.width + 1;
  }

  function onPointerDown(event: PointerEvent) {
    if (mode === 'vertical') {
      pointerStart = { x: event.clientX, y: event.clientY };
      return;
    }

    if (turnTimer) return;

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      gesture = startDrag(event.clientX, event.clientY);
    } else if (pointers.size === 2) {
      dragX = 0;
      const start = pinchState();

      gesture = { kind: 'pinch', ...start, zoom, panX: pan.x, panY: pan.y };
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!gesture || !pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (gesture.kind === 'pinch') {
      if (pointers.size < 2) return;

      // The point under the fingers when the pinch began stays under them.
      const now = pinchState();
      const next = Math.max(1, Math.min(maxZoom, (gesture.zoom * now.distance) / gesture.distance));
      const ratio = next / gesture.zoom;

      zoom = next;
      setPan(
        now.x - (gesture.x - gesture.panX) * ratio,
        now.y - (gesture.y - gesture.panY) * ratio
      );
      return;
    }

    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (gesture.kind === 'pending') {
      if (Math.hypot(dx, dy) < 10) return;

      const horizontal = Math.abs(dx) > Math.abs(dy);

      gesture = { ...gesture, kind: horizontal && !canPanX(dx) ? 'swipe' : 'pan' };
    }

    if (gesture.kind === 'pan') {
      setPan(gesture.panX + dx, gesture.panY + dy);
    } else {
      // Past the first or last spread the page only gives a little.
      const dir = (dx < 0 ? 1 : -1) * sign;

      dragX = groups[groupIndex + dir] ? dx : dx / 4;
    }
  }

  function onPointerUp(event: PointerEvent, cancelled = false) {
    if (mode === 'vertical') {
      if (!cancelled) stripPointerUp(event);
      return;
    }

    if (!pointers.delete(event.pointerId) || !gesture) return;

    if (gesture.kind === 'pinch') {
      // One finger left keeps panning from where it is.
      const [rest] = [...pointers.values()];

      gesture = rest ? { ...startDrag(rest.x, rest.y), kind: 'pan' } : undefined;
      return;
    }

    if (pointers.size) return;

    const ended = gesture;

    gesture = undefined;

    if (cancelled) {
      if (ended.kind === 'swipe') snapBack();
    } else if (ended.kind === 'pending') {
      tap(event.clientX, event.clientY);
    } else if (ended.kind === 'swipe') {
      const dir = (dragX < 0 ? 1 : -1) * sign;

      if (Math.abs(dragX) > Math.min(80, viewWidth / 5)) {
        showMenu = false;
        turn(dir);
      } else {
        snapBack();
      }
    }
  }

  function tap(x: number, y: number) {
    if (!$mangaDoubleTapZoom$) {
      singleTap(x, y);
      return;
    }

    const now = Date.now();

    if (lastTap && now - lastTap.time < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
      clearTimeout(tapTimer);
      lastTap = undefined;

      if (zoom > 1) resetView(groupIndex, base, true);
      else zoomAt(2.5, x, y);

      return;
    }

    lastTap = { x, y, time: now };
    clearTimeout(tapTimer);
    // Waits to see whether a second tap makes it a double tap.
    tapTimer = setTimeout(() => singleTap(x, y), 300);
  }

  /** The tap zones turn the page, unless zoomed in; the rest toggles the menu. */
  function singleTap(x: number, y: number) {
    const dir = zoom > 1 ? 0 : tapDirection(x, y, view, mode, $mangaTapLayout$, $mangaTapInvert$);

    if (dir) {
      turn(dir);
      showMenu = false;
    } else {
      showMenu = !showMenu;
    }
  }

  function stripPointerUp(event: PointerEvent) {
    if (!pointerStart) return;

    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;

    pointerStart = undefined;

    if (Math.abs(dx) >= 10 || Math.abs(dy) >= 10 || (event.target as Element).closest('button')) {
      return;
    }

    const dir = tapDirection(
      event.clientX,
      event.clientY,
      view,
      mode,
      $mangaTapLayout$,
      $mangaTapInvert$
    );

    if (dir) {
      // Most of a screen, so the last lines stay in view.
      strip?.scrollBy({
        top: dir * 0.75 * viewHeight,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth'
      });
      showMenu = false;
    } else {
      showMenu = !showMenu;
    }
  }

  function onWheel(event: WheelEvent) {
    if (mode === 'vertical') return;

    event.preventDefault();

    if (event.ctrlKey) {
      // Also trackpad pinches, which browsers send as Ctrl+wheel.
      zoomAt(zoom * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    } else if (overflows) {
      setPan(pan.x - event.deltaX, pan.y - event.deltaY);
    } else if (Math.abs(event.deltaY) > 4 && Date.now() - lastWheelTurn > 400) {
      lastWheelTurn = Date.now();
      // A scroll's momentum shouldn't open the next volume: that takes a key, tap or swipe.
      if (Math.sign(event.deltaY) !== transition) turn(Math.sign(event.deltaY));
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;

    const forward = mode === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = mode === 'rtl' ? 'ArrowRight' : 'ArrowLeft';

    if (event.key === 'Escape') {
      if (showMore) return;
      if (showSettings) showSettings = false;
      else if (transition && mode !== 'vertical') leave();
      else showMenu = !showMenu;
    } else if (mode === 'vertical') {
      return;
    } else if (event.key === forward || event.key === ' ' || event.key === 'PageDown') {
      turn(1);
    } else if (event.key === back || event.key === 'PageUp') {
      turn(-1);
    } else {
      return;
    }

    event.preventDefault();
  }

  // ---- screen ----

  async function updateWakeLock(keepOn: boolean) {
    if (!wakeLockSupported) return;

    if (keepOn && document.visibilityState === 'visible') {
      wantWakeLock = true;

      if (requestingWakeLock || (wakeLock && !wakeLock.released)) return;

      requestingWakeLock = true;

      const lock = await navigator.wakeLock.request('screen').catch(({ message }) => {
        logger.warn(`Could not keep the screen on: ${message}`);

        return undefined;
      });

      requestingWakeLock = false;
      // The reader may have closed, or the setting turned off, while the browser was asked.
      if (wantWakeLock) wakeLock = lock;
      else await lock?.release().catch(() => {});
    } else {
      wantWakeLock = false;
      await wakeLock?.release().catch(() => {});
      wakeLock = undefined;
    }
  }

  /** The bar's mode and text buttons step through their options. */
  function next<T>(options: ToggleOption<T>[], current: T) {
    return options[(options.findIndex((option) => option.id === current) + 1) % options.length].id;
  }

  function toggleFullscreen() {
    if (fullscreenManager.fullscreenElement) fullscreenManager.exitFullscreen();
    else fullscreenManager.requestFullscreen(document.documentElement);
  }

  async function leave() {
    await save().catch((error) => logger.warn(error.message));
    await database.deleteLastItem();
    goto(`${pagePath}/manage`);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') save();
    // The browser drops the lock when the page is hidden.
    updateWakeLock($mangaKeepScreenOn$);
  }

  onMount(() => {
    load(Number($page.url.searchParams.get('id'))).catch((error) =>
      logger.error(`Error loading manga: ${error.message}`)
    );
  });

  onDestroy(() => {
    save();
    clearTimeout(tapTimer);
    clearTimeout(turnTimer);
    decoded.clear();
    updateWakeLock(false);
    urls.forEach((url) => URL.revokeObjectURL(url));
  });
</script>

<svelte:head>
  <title>{formatPageTitle(book?.title ?? '')}</title>
</svelte:head>

<svelte:window on:keydown={onKeydown} />
<svelte:document on:visibilitychange={onVisibilityChange} />

<div
  class="fixed inset-0 select-none overflow-hidden"
  style:background
  style:touch-action={mode === 'vertical' ? 'pan-y pinch-zoom' : 'none'}
  bind:clientWidth={viewWidth}
  bind:clientHeight={viewHeight}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={(event) => onPointerUp(event)}
  on:pointercancel={(event) => onPointerUp(event, true)}
  on:wheel|nonpassive={onWheel}
>
  {#if mode === 'vertical'}
    <div class="h-full overflow-y-auto" bind:this={strip} on:scroll={onStripScroll}>
      {#each urls as url, index}
        <div class="relative mx-auto w-full max-w-3xl">
          <img
            src={url}
            alt="Page {index + 1}"
            loading="lazy"
            draggable="false"
            class="block w-full"
            class:min-h-[60vh]={!loaded.has(index)}
            on:load={() => (loaded = new Set(loaded).add(index))}
          />
          {#if pageText[index] && $mangaText$ !== 'off' && loaded.has(index)}
            <MokuroOverlay page={pageText[index]} mode={$mangaText$} />
          {/if}
        </div>
      {/each}
      {#if ready && volumes.next}
        <div class="flex justify-center px-4 py-10">
          <VolumeTransition
            direction={1}
            title={book?.title ?? ''}
            current={currentVolume}
            {pageCount}
            volume={volumes.next}
            {opening}
            error={openError}
            on:open={(event) => openVolume(event.detail)}
            on:library={leave}
          />
        </div>
      {/if}
    </div>
  {:else if !transition}
    <!-- The spreads either side are laid out beside this one, so a swipe drags them in. -->
    {#each slots as index (index)}
      <div
        class="absolute left-0 top-0 flex"
        class:flex-row-reverse={mode === 'rtl'}
        style={slotStyle(index)}
      >
        {#each groups[index] as pageNumber (pageNumber)}
          <div class="relative h-full flex-none">
            <img
              src={urls[pageNumber]}
              alt="Page {pageNumber + 1}"
              draggable="false"
              class="block h-full w-auto max-w-none"
            />
            {#if pageText[pageNumber] && $mangaText$ !== 'off'}
              <MokuroOverlay page={pageText[pageNumber]} mode={$mangaText$} />
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

{#if transition && mode !== 'vertical'}
  <!-- Outside the gesture layer, so its buttons get clicks; the sides still turn. -->
  <div class="pointer-events-none fixed inset-0 flex items-center justify-center p-4">
    <div class="pointer-events-auto">
      <VolumeTransition
        direction={transition}
        title={book?.title ?? ''}
        current={currentVolume}
        {pageCount}
        volume={transition > 0 ? volumes.next : volumes.previous}
        {opening}
        error={openError}
        keys={mode === 'rtl' ? ['←', '→'] : ['→', '←']}
        on:open={(event) => openVolume(event.detail)}
        on:library={leave}
      />
    </div>
  </div>
{/if}

{#if $mangaPageNumber$ && !showMenu && pageCount && !transition}
  <div
    class="reader-panel pointer-events-none fixed bottom-2 left-1/2 -translate-x-1/2 px-3 py-0.5 text-xs tabular-nums opacity-80"
  >
    {pagesLabel} / {pageCount}
  </div>
{/if}

{#if showMenu || transition}
  <div class="fixed inset-x-0 top-0 z-10" transition:fly={{ y: -40, duration: 150 }}>
    <PlayerBar title={barTitle} place={barPlace} on:back={leave}>
      <button
        class="bar-text bar-wide"
        title="Reading mode"
        on:click={() => ($readingMode = next(modes, mode))}
      >
        <Fa icon={faBookOpen} />{modeLabel}
      </button>
      <button
        class="bar-icon bar-narrow"
        title="Reading mode: {modeLabel}"
        on:click={() => ($readingMode = next(modes, mode))}
      >
        <Fa icon={faBookOpen} />
      </button>
      {#if hasText}
        <button
          class="bar-text bar-wide"
          title="Page text"
          on:click={() => ($mangaText$ = next(textModes, $mangaText$))}
        >
          Text: {textLabel}
        </button>
      {/if}
      <button
        class="bar-icon"
        class:bar-icon-active={showSettings}
        title="Reader settings"
        aria-expanded={showSettings}
        on:click={() => (showSettings = !showSettings)}
      >
        <Fa icon={faSliders} />
      </button>
      {#if fullscreenManager.fullscreenEnabled}
        <button class="bar-icon bar-wide" title="Full screen" on:click={toggleFullscreen}>
          <Fa icon={faExpand} />
        </button>
      {/if}
      {#if moreItems.length || fullscreenManager.fullscreenEnabled}
        <button
          class="bar-icon"
          class:bar-icon-active={showMore}
          title="More"
          aria-expanded={showMore}
          on:click={() => (showMore = !showMore)}
        >
          <Fa icon={faEllipsis} />
        </button>
      {/if}
    </PlayerBar>
  </div>
{/if}

{#if showMenu && !transition && !showSettings}
  <div class="manga-bottom" transition:fly={{ y: 40, duration: 150 }}>
    <div class="manga-slider-row">
      <div class="manga-slider-track" dir={mode === 'rtl' ? 'rtl' : 'ltr'}>
        <span class="manga-end">1</span>
        <div class="manga-slider">
          <!-- Over the thumb's centre: the thumb (1rem) travels the track less its width. -->
          <span
            class="manga-bubble"
            dir="ltr"
            style="{mode === 'rtl' ? 'right' : 'left'}: calc({sliderAt}% + {(50 - sliderAt) *
              0.01}rem)"
          >
            {pagesLabel}
          </span>
          <input
            type="range"
            min="0"
            max={Math.max(pageCount - 1, 0)}
            value={pageIndex}
            aria-label="Page"
            style:background="linear-gradient(to {mode === 'rtl' ? 'left' : 'right'},
            var(--accent-color) {sliderAt}%, var(--app-progress-track) {sliderAt}%)"
            on:input={(event) => goToPage(Number(event.currentTarget.value))}
          />
        </div>
        <span class="manga-end">{pageCount}</span>
      </div>
      <span class="manga-percent">{[volumeLabel, `${percent}%`].filter(Boolean).join(' · ')}</span>
    </div>
    <div class="manga-phone-row">
      <button on:click={() => ($readingMode = next(modes, mode))}>{modeLabel}</button>
      {#if hasText}
        <button on:click={() => ($mangaText$ = next(textModes, $mangaText$))}>
          Text: {textLabel}
        </button>
      {/if}
    </div>
    {#if openError}
      <div class="pt-2 text-center text-danger">{openError}</div>
    {/if}
  </div>
{/if}

{#if showSettings}
  <div class="manga-scrim" aria-hidden="true" on:click={() => (showSettings = false)} />
  <aside class="manga-settings" aria-label="Manga settings">
    <h2 class="manga-settings-title">Manga</h2>
    <SectionHead number={1} title="Reading" level="h3" />
    <SettingsItemGroup
      title="Reading mode"
      wide
      tooltip={volumes.series
        ? `Kept for this series: ${volumes.series}`
        : 'Kept for manga outside a series.'}
    >
      <ButtonToggleGroup options={modes} bind:selectedOptionId={$readingMode} />
    </SettingsItemGroup>
    {#if mode !== 'vertical'}
      <SettingsItemGroup
        title="Two-page spreads"
        tooltip="Auto shows spreads on screens wider than tall. Cover, wide and last pages stay single; Shift pairs the cover too."
      >
        <div class="flex items-center gap-2">
          <ButtonToggleGroup options={dualPages} bind:selectedOptionId={$mangaDualPage$} />
          {#if dual}
            <button class="app-button" aria-pressed={shift} on:click={() => (shift = !shift)}>
              Shift
            </button>
          {/if}
        </div>
      </SettingsItemGroup>
      <SettingsItemGroup title="Scale">
        <ButtonToggleGroup options={scales} bind:selectedOptionId={$mangaScale$} />
      </SettingsItemGroup>
    {/if}
    <div class="manga-section"><SectionHead number={2} title="Taps" level="h3" /></div>
    <SettingsItemGroup
      title="Tap zones"
      wide
      tooltip="Where a tap turns the page. Default is the sides for pages and an L shape for the vertical strip (top and left back, bottom and right forward)."
    >
      <ButtonToggleGroup options={tapLayouts} bind:selectedOptionId={$mangaTapLayout$} />
    </SettingsItemGroup>
    {#if $mangaTapLayout$ !== 'off'}
      <SettingsItemGroup title="Invert">
        <ButtonToggleGroup options={tapInverts} bind:selectedOptionId={$mangaTapInvert$} />
      </SettingsItemGroup>
    {/if}
    {#if mode !== 'vertical'}
      <SettingsItemGroup title="Double tap to zoom" tooltip="Single taps then wait a moment.">
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={$mangaDoubleTapZoom$}
        />
      </SettingsItemGroup>
    {/if}
    <div class="manga-section"><SectionHead number={3} title="Display" level="h3" /></div>
    <SettingsItemGroup title="Background">
      <ButtonToggleGroup options={backgrounds} bind:selectedOptionId={$mangaBackground$} />
    </SettingsItemGroup>
    <SettingsItemGroup title="Page number">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$mangaPageNumber$} />
    </SettingsItemGroup>
    {#if wakeLockSupported}
      <SettingsItemGroup title="Keep screen on" tooltip="Wake lock while the reader is open.">
        <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$mangaKeepScreenOn$} />
      </SettingsItemGroup>
    {/if}
    {#if hasText}
      <SettingsItemGroup title="Text overlay" tooltip="Text recognised by mokuro, for Yomitan.">
        <ButtonToggleGroup options={textModes} bind:selectedOptionId={$mangaText$} />
      </SettingsItemGroup>
    {/if}
  </aside>
{/if}

{#if showMore}
  <ReaderSheet title="More" on:close={() => (showMore = false)}>
    <ul class="manga-more">
      {#each moreItems as item (item.label)}
        <li>
          <button
            disabled={opening}
            lang="ja"
            on:click={() => {
              showMore = false;
              openVolume(item.volume);
            }}
          >
            {item.label}
          </button>
        </li>
      {/each}
      {#if fullscreenManager.fullscreenEnabled}
        <li>
          <button
            on:click={() => {
              showMore = false;
              toggleFullscreen();
            }}
          >
            Full screen
          </button>
        </li>
      {/if}
    </ul>
  </ReaderSheet>
{/if}

<style>
  .manga-bottom {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 10;
    padding: 1.75rem 1.25rem 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .manga-slider-row,
  .manga-slider-track {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .manga-slider-track {
    flex: 1;
  }

  .manga-end,
  .manga-percent {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    white-space: nowrap;
  }

  .manga-percent {
    margin-left: 0.5rem;
  }

  .manga-slider {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
  }

  .manga-bubble {
    position: absolute;
    bottom: 1rem;
    padding: 0.05rem 0.4rem;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }

  [dir='rtl'] .manga-bubble {
    transform: translateX(50%);
  }

  /* Square thumb on a 3px track; the read part is filled (inline background) */
  .manga-slider input {
    width: 100%;
    height: 3px;
    appearance: none;
    border-radius: 0;
    cursor: pointer;
  }

  .manga-slider input::-webkit-slider-thumb {
    width: 1rem;
    height: 1rem;
    appearance: none;
    border-radius: 2px;
    background: var(--accent-color);
  }

  .manga-slider input::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    border: 0;
    border-radius: 2px;
    background: var(--accent-color);
  }

  .manga-phone-row {
    display: none;
  }

  @media (max-width: 767px) {
    .manga-percent {
      display: none;
    }

    .manga-phone-row {
      display: flex;
      justify-content: space-between;
      padding-top: 0.5rem;
      color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
      font-size: var(--type-body);
    }

    .manga-phone-row button {
      min-height: 2.75rem;
    }
  }

  .manga-scrim {
    position: fixed;
    inset: 3.5rem 0 0;
    z-index: 9;
    background: var(--app-overlay-color);
  }

  .manga-settings {
    position: fixed;
    top: 3.5rem;
    right: 0;
    bottom: 0;
    z-index: 11;
    width: min(32.5rem, 100vw);
    overflow-y: auto;
    padding: 1.25rem 1.75rem 2rem;
    border-left: 1px solid var(--border-color);
    background: var(--background-color);
    color: var(--font-color);
    font-family: var(--app-font-ui);
  }

  .manga-settings-title {
    margin: 0 0 1.25rem;
    font-size: var(--type-h2);
    font-weight: 400;
  }

  .manga-section {
    margin-top: 1.75rem;
  }

  .manga-more {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .manga-more button {
    display: flex;
    width: 100%;
    min-height: 3.25rem;
    align-items: center;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    text-align: left;
  }

  .manga-more button:hover:not(:disabled) {
    color: var(--accent-strong-color);
  }

  .manga-more button:disabled {
    opacity: 0.5;
  }
</style>
