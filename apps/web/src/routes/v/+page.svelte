<script lang="ts">
  /**
   * Visual novel player (not part of upstream): the engine runs in a same-origin frame,
   * CONscripter for ONScripter games (static/vn/player.html) or VNBox for Windows games
   * (static/vn/vnbox.html, windows-game.ts); its text hook sends the text the game shows,
   * which the frame lays invisibly over the game for Yomitan and this page shows in a panel
   * below it (optional) and counts for progress and statistics (vn-text.ts). Saves of
   * ONScripter games on a synced source sync through vnsaves.json in the game's folder
   * (sync-files.ts); so do Windows games' save files (vn-save-store.ts: pulled before the game
   * starts, pushed when the tab is hidden or the game closes).
   */
  import { noteReading } from '$lib/data/social';
  import { readingActivity } from '$lib/data/reader-hooks';
  import { isPluginEnabled } from '$lib/plugins';
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$lib/data/page-store';
  import ReaderSheet from '$lib/components/book-reader/reader-sheet.svelte';
  import ReaderMoreList from '$lib/components/book-reader/reader-more-list.svelte';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import {
    autoReplication$,
    database,
    startDayHoursForTracker$,
    statisticsEnabled$
  } from '$lib/data/store';
  import { context, externalHandler, handler } from '$lib/data/media-sync';
  import { pagePath } from '$lib/data/env';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import {
    encodePath,
    fromBase64,
    hashPage,
    loadVnRead,
    newerSaveEngine,
    vnCacheName,
    parseVnPage,
    saveVnRead,
    vnBookmark,
    vnInfo,
    type VnLine,
    type VnSaves
  } from '$lib/data/vn';
  import { VnReading, vnTextSource } from '$lib/data/vn-text';
  import {
    fittedTuning,
    hasWindowsGame,
    loadVnboxTuning,
    saveVnboxTuning,
    vnboxPlayerUrl,
    vnboxErrorText,
    windowsGameBlocker,
    windowsGameBlockerText
  } from '$lib/data/windows-game';
  import { recordKanjiText } from '$lib/data/kanji-seen';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import {
    AutoReplicationType,
    ReplicationSaveBehavior
  } from '$lib/functions/replication/replication-options';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { vnFolderSize } from '$lib/functions/file-loaders/vn/load-vn';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import AnkiWatcher from '$lib/components/anki-watcher.svelte';
  import VnboxTuning from '$lib/components/vn/vnbox-tuning.svelte';
  import VnboxDiscs from '$lib/components/vn/vnbox-discs.svelte';
  import VnBacklog from '$lib/components/vn/vn-backlog.svelte';
  import VnSavesSheet from '$lib/components/vn/vn-saves.svelte';
  import VnBar from '$lib/components/vn/vn-bar.svelte';
  import VnRail from '$lib/components/vn/vn-rail.svelte';
  import VnSide from '$lib/components/vn/vn-side.svelte';
  import { VnSaveSync, vnSaveAreas } from '$lib/data/vn-save-store';
  import { dialogManager } from '$lib/data/dialog-manager';
  import WindowsGameDialog from '$lib/components/book-card/windows-game-dialog.svelte';
  import VnboxHooks from '$lib/components/vn/vnbox-hooks.svelte';
  import { hookCleaner, type HookCleanup } from '$lib/data/hook-cleanup';
  import LookupPopup from '$lib/components/dictionary/lookup-popup.svelte';
  import { builtInLookups$ } from '$lib/data/dictionary';
  import {
    ankiEnabled$,
    ankiSentenceField$,
    ankiVnAudio$,
    ankiVnScreenshot$,
    noteSentence,
    vnLineFor,
    type AnkiNote
  } from '$lib/data/anki';
  import { serverConnected, serverFetch } from '$lib/data/server-connect';
  import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
  import { padStep, watchGamepads, type PadAction } from '$lib/data/vn-gamepad';

  /** The text panel below the game; hovering the game's own text works without it. */
  const showText$ = writableBooleanLocalStorageSubject()('vnTextPanel', false);
  /** Furigana drawn by the game; off, the readings are still in the overlay and text panel. */
  const furigana$ = writableBooleanLocalStorageSubject()('vnFurigana', true);
  /** The whole text at once instead of the game's text speed. */
  const instantText$ = writableBooleanLocalStorageSubject()('vnInstantText', false);
  /** The touch rail's big Menu, Skip and Full screen buttons (landscape); folded, its handle. */
  const railOpen$ = writableBooleanLocalStorageSubject()('vnRailOpen', true);

  let book: BooksDbBookData | undefined;
  let frame: HTMLIFrameElement | undefined;
  let frameLoaded = false;
  let lookupPopup: LookupPopup | undefined;
  let lines: VnLine[] = [];
  let ended = false;
  let reading: VnReading | undefined;
  /** The game's text source and frame (CONscripter or VNBox) */
  $: info = book && vnInfo(book);
  $: source = info && vnTextSource(info, onText);
  $: windows = info?.engine === 'vnbox';
  /** Why a Windows game can't start here: a phone, an older browser, or no game files */
  let blocked: string | undefined;
  /** A Windows game's text hook script, as a URL VNBox can fetch */
  let hookUrl: string | undefined;
  /** A Windows game's VNBox settings from the Tuning sheet; a new value restarts the game. */
  let tuning = '';
  let showTuning = false;
  /** The Backlog sheet: the lines kept for Anki mining */
  let showBacklog = false;
  let showHooks = false;
  /** The Saves sheet; the game is stopped while it is open. */
  let showSaves = false;
  /** A Windows game's text cleanup, run on hooked lines in vnbox.js (`clean`) */
  let hookCleanup: HookCleanup = {};
  $: cleanLine = hookCleaner(hookCleanup);
  /** The frame waits for load(): a Windows game's address depends on it. */
  let loaded = false;
  $: playerUrl =
    loaded && info && source && !blocked
      ? windows
        ? vnboxPlayerUrl(info, hookUrl, tuning)
        : `${pagePath}/vn/${source.player}`
      : undefined;
  /** CONscripter version of this build, stamped on uploaded saves. */
  let engineVersion: string | undefined;
  /** Set when synced saves were written by a newer engine than this one. */
  let newerEngine: string | undefined;
  let local: BrowserStorageHandler;
  let external: BaseStorageHandler | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  /** vnsaves.json sync of this game's saves (vn-save-store.ts), from load() */
  let saveSync: VnSaveSync | undefined;
  /** Why a Windows game's saves don't sync */
  let savesNote: string | undefined;
  /** This game's files are missing here: the import dialog can add them to this record. */
  let missingFiles = false;

  // The player holds taps on its text for the built-in dictionary only while it is on.
  $: if (frameLoaded && frame?.contentWindow) {
    (frame.contentWindow as any).textTap = $builtInLookups$ ? textTap : null;
  }

  /** A tap on the game's text (frame coordinates): true when it found a word. */
  function textTap(x: number, y: number) {
    const box = frame?.getBoundingClientRect();
    return !!box && !!lookupPopup?.tapAt(x + box.left, y + box.top);
  }
  /** A server game over 10 MB asks before its files are kept in the browser. */
  let keepAsk: { size: string; answer: (keep: boolean) => void } | undefined;
  let showMore = false;
  /** Bumped to load the player frame again (Tuning's restart) */
  let restarts = 0;
  /** The engine's skip mode, as it reports it (consMode) */
  let skipping = false;
  /** For the progress line: characters read, and today */
  let readCharacters = 0;
  let todayCharacters = 0;

  $: percent = book?.characters ? Math.min(100, (readCharacters / book.characters) * 100) : 0;
  $: moreList = [
    fullscreenManager.fullscreenEnabled && {
      label: 'Full screen',
      onclick: () => {
        showMore = false;
        toggleFullscreen();
      }
    },
    windows &&
      !blocked && {
        label: 'Tuning',
        onclick: () => {
          showMore = false;
          showTuning = true;
        }
      },
    windows &&
      !blocked && {
        label: 'Hooks',
        onclick: () => {
          showMore = false;
          showHooks = true;
        }
      },
    !blocked && {
      label: 'Backlog',
      onclick: () => {
        showMore = false;
        showBacklog = true;
      }
    },
    { label: 'Saves', onclick: openSaves },
    { label: 'Statistics', onclick: openStatistics }
  ].filter(Boolean) as { label: string; onclick: () => void }[];
  // What is open, for the plugins (Discord status).
  $: if (book && readCharacters >= 0) {
    readingActivity({
      kind: 'vn',
      title: book.title,
      position: readCharacters,
      characters: book.characters
    });
  }

  $: if (started) engineSet('Ruby', $furigana$ ? 1 : 0);
  $: if (started) engineSet('TextSpeed', $instantText$ ? 0 : -1);

  function engineSet(name: string, value: number) {
    (frame?.contentWindow as any)?.engineSet(name, value);
  }

  function syncs(direction: AutoReplicationType) {
    return (
      external &&
      (external.storageType === StorageKey.CALIBRE ||
        $autoReplication$ === direction ||
        $autoReplication$ === AutoReplicationType.All)
    );
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
    saveSync = new VnSaveSync(
      data.title,
      vnInfo(data),
      data.storageSource,
      (note) => (savesNote = note)
    );
    hookCleanup = vnInfo(data).hookCleanup ?? {};
    local.startContext(context(book!));
    data.lastBookOpen = Date.now();
    await local.updateLastRead(data);

    try {
      external = await externalHandler(data);

      if (external) {
        external.startContext(context(book!));

        if (syncs(AutoReplicationType.Down)) {
          const error = await replicateData(
            external,
            local,
            false,
            [context(book!)],
            [StorageDataType.PROGRESS, StorageDataType.STATISTICS]
          );

          if (error) throw new Error(error);
        }

        await external.updateLastRead(data);
      }
    } catch (error: any) {
      // Playing works offline from the browser copy; progress syncs on the next save.
      logger.warn(`Visual novel sync failed: ${error.message}`);
    }

    const read = await loadVnRead(data.title);

    // Another device may be further along: keep the larger position.
    const bookmark = await database.getBookmark(data.id);

    read.characters = Math.max(read.characters, bookmark?.exploredCharCount || 0);
    reading = new VnReading(
      read,
      new Map((await database.getStatisticsForBook(data.title)).map((stat) => [stat.dateKey, stat]))
    );
    updateProgress();
    // A game of unknown length (Windows) counts as being read once opened, hooked or not.
    if (!data.characters && !bookmark?.progress) {
      await database.putBookmark(vnBookmark(data.id, read.characters, 0));
    }

    const game = vnInfo(data);

    if (game.engine === 'vnbox') {
      // The OPFS game copy and VNBox's saves must not be evicted.
      navigator.storage?.persist?.();
      const blocker = windowsGameBlocker();

      missingFiles = !blocker && !(await hasWindowsGame(game.folder!));
      blocked = blocker
        ? windowsGameBlockerText[blocker]
        : missingFiles
          ? "This game's files aren't in this browser: it was added on another device. Add its folder, or a ZIP of it on a phone, to play it here; its saves come along when they sync."
          : undefined;
      // Its record (program, hook; no files) goes up with each start, so other devices list
      // the game and open it here to ask for the files instead of failing.
      if (!missingFiles && external) {
        external
          .saveBook(data, false)
          .catch((error) => logger.warn(`Visual novel sync failed: ${error.message}`));
      }
      tuning = loadVnboxTuning(game.folder!);
      if (game.hook) {
        hookUrl = URL.createObjectURL(new Blob([game.hook], { type: 'text/javascript' }));
      }
    }
    loaded = true;
  }

  function updateProgress() {
    if (!reading) return;
    readCharacters = reading.read.characters;
    todayCharacters = reading.today($startDayHoursForTracker$);
  }

  /** /v with a Windows game's files missing: the import dialog copies them in for this record. */
  function addGameFolder() {
    dialogManager.dialogs$.next([
      {
        component: WindowsGameDialog as any,
        props: {
          existing: book!.title,
          added: () => {
            missingFiles = false;
            blocked = undefined;
          }
        },
        disableCloseOnClick: true
      }
    ]);
  }

  /** Games served by URL over 10 MB can be kept in the browser (Cache API, HTTPS only). */
  async function gameCache(base: string | undefined) {
    if (!base || !('caches' in window)) return undefined;

    const name = vnCacheName(book!.title);

    if (await caches.has(name)) return name;

    const size = await vnFolderSize(base).catch(() => 0);

    if (size <= 10 * 1024 * 1024) return undefined;

    const keep = await new Promise<boolean>((answer) => {
      keepAsk = {
        size:
          size >= 1024 ** 3
            ? `${(size / 1024 ** 3).toFixed(1)} GB`
            : `${Math.round(size / 1024 ** 2)} MB`,
        answer
      };
    });

    keepAsk = undefined;

    if (!keep) return undefined;

    navigator.storage?.persist?.();
    return name;
  }

  async function start() {
    if (!book || !info || !source || !reading || !frame?.contentWindow) return;

    const player = frame.contentWindow as any;

    if (windows) {
      await saveSync!.pullWindows();
      // A new frame holds no Ctrl.
      skipping = false;
      reading.lastTextTime = Date.now();
      await player.startGame({
        keepLines: $ankiEnabled$,
        recordLines: $ankiEnabled$ && $ankiVnAudio$,
        textLines: source.textLines,
        onText: source.onText,
        onScreen: fitScreen,
        clean: (line: string, thread: string) => cleanLine(line, thread)
      });
      started = true;
      return;
    }

    // A delete from the Saves sheet reaches vnsaves.json first, or the game would bring it back.
    await saveSync!.queue;
    const saves = await saveSync!.fetch().catch((error): VnSaves => {
      // Offline: play with this browser's saves.
      logger.warn(`Visual novel save sync failed: ${error.message}`);
      return {};
    });
    engineVersion = await fetch(`${pagePath}/vn/conscripter-version.txt`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.text() : undefined))
      .then((text) => text?.trim())
      .catch(() => undefined);
    newerEngine = engineVersion && newerSaveEngine(saves, engineVersion);
    const cacheName = await gameCache(info.base);

    reading.lastTextTime = Date.now();
    await player.startGame({
      // Server folder games are fetched by URL; imported ones are blobs.
      files: info.base
        ? Object.fromEntries(info.files.map((path) => [path, `${info.base}${encodePath(path)}`]))
        : await database.getBlobs(book),
      cacheName,
      // A connected server's game files need its token, which a URL can't carry.
      fetchFile: serverConnected ? serverFetch : undefined,
      keepLines: $ankiEnabled$,
      recordLines: $ankiEnabled$ && $ankiVnAudio$,
      encoding: info.encoding,
      saveDir: `/save/${hashPage(book.title)}`,
      saves: Object.fromEntries(
        Object.entries(saves).flatMap(([name, file]) => {
          // One bad entry in the synced file must not stop the game starting.
          if (typeof file?.data !== 'string' || typeof file.modified !== 'number') return [];
          try {
            return [[name, { modified: file.modified, bytes: fromBase64(file.data) }]];
          } catch {
            return [];
          }
        })
      ),
      onText: source.onText,
      textLines: source.textLines,
      onSave: (files: Parameters<VnSaveSync['upload']>[0]) =>
        saveSync!.upload(files, engineVersion),
      onMode: (auto: boolean, skip: boolean) => (skipping = skip),
      onExit: () => (ended = true)
    });
    started = true;
  }

  /**
   * For a note added to Anki while playing: the screen and sound of the line its sentence was
   * mined from, kept by the player as it was shown, or of the backlog it was mined from. Notes
   * from elsewhere are left alone.
   */
  async function ankiMedia(note: AnkiNote) {
    const player = frame?.contentWindow as any;
    const sentence = noteSentence(note);
    const kept = player?.ankiTexts ? vnLineFor(sentence, player.ankiTexts()) : -1;
    const shown = player?.ankiShownTexts ? vnLineFor(sentence, player.ankiShownTexts()) : -1;

    if (kept < 0 && shown < 0) {
      throw new Error(
        `card left alone, its ${$ankiSentenceField$.trim()} field isn't a line of this game's recent text or backlog`
      );
    }

    return player.ankiMedia(kept, shown, { picture: $ankiVnScreenshot$, audio: $ankiVnAudio$ });
  }

  function onText(text: string, skipped: boolean, readBefore: boolean) {
    if (!reading) return;

    lines = parseVnPage(text);

    const dirty = reading.add(text, skipped, readBefore, {
      statistics: $statisticsEnabled$,
      startDayHours: $startDayHoursForTracker$
    });

    updateProgress();

    if (dirty) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 3000);
    }
  }

  async function save() {
    clearTimeout(saveTimer);

    const changes = book && reading?.takeChanges();

    if (!book || !changes) return;

    const { read, text, days } = changes;

    await saveVnRead(read);
    await recordKanjiText(book.title, text, read.characters);
    await database.putBookmark(vnBookmark(book.id, read.characters, book.characters));
    if (isPluginEnabled('social'))
      noteReading(book.title, read.characters, book.characters, false, 'vn');

    const types = [StorageDataType.PROGRESS];

    if (days.length) {
      await database.storeStatistics(
        book.title,
        days,
        ReplicationSaveBehavior.Overwrite,
        MergeMode.LOCAL
      );
      types.push(StorageDataType.STATISTICS);
    }

    if (syncs(AutoReplicationType.Up)) {
      const error = await replicateData(local, external!, false, [context(book!)], types).catch(
        (err: any) => err.message
      );

      if (error) logger.warn(`Visual novel progress sync failed: ${error}`);
    }
  }

  async function leave() {
    await save().catch((error) => logger.warn(error.message));
    await database.deleteLastItem();
    goto(`${pagePath}/manage`);
  }

  function toggleSkip() {
    skipping = !skipping;
    engineSet('Skip', skipping ? 1 : 0);
  }

  /** Saves the Tuning sheet's settings and starts the game again with them. */
  async function applyTuning(next: string) {
    showTuning = false;
    await save().catch((error) => logger.warn(error.message));
    saveVnboxTuning(info!.folder!, next);
    tuning = next;
    frameLoaded = false;
    started = false;
    restarts += 1;
  }

  /** Stops the game for the Saves sheet; closing the sheet starts it again. */
  async function openSaves() {
    showMore = false;
    saveSync?.pushWindows();
    await save().catch((error) => logger.warn(error.message));
    frameLoaded = false;
    started = false;
    showSaves = true;
  }

  function closeSaves() {
    showSaves = false;
    restarts += 1;
  }

  /** A Windows game's screen took a new size: a game Wine cut off restarts once to keep its own. */
  function fitScreen(width: number, height: number) {
    // Until the restarted frame has started: the old one's sizes are stale.
    const fitted = started && fittedTuning(loadVnboxTuning(info!.folder!), width, height);

    if (!fitted) return;
    if (fitted.restart) applyTuning(fitted.tuning);
    else saveVnboxTuning(info!.folder!, fitted.tuning);
  }

  function openMenu() {
    (frame?.contentWindow as any)?.openMenu();
  }

  $: skipTitle = windows ? 'Skip text (holds Ctrl in the game)' : 'Skip text';
  /**
   * Toggles in the bar, and on portrait phones in a row under it. Menu and Skip only on touch
   * screens (in the rail when landscape); Furigana and Instant text are CONscripter's.
   */
  $: chips = [
    ...(windows
      ? []
      : [
          {
            label: 'Furigana',
            title: 'Furigana in the game (from the next text; readings stay in the text panel)',
            on: $furigana$,
            click: () => furigana$.next(!$furigana$)
          },
          {
            label: 'Instant text',
            title: 'Show the whole text at once',
            on: $instantText$,
            click: () => instantText$.next(!$instantText$)
          }
        ]),
    {
      label: 'Menu',
      title: "The game's menu (right-click)",
      on: undefined,
      click: openMenu,
      phone: true
    },
    { label: 'Skip', title: skipTitle, on: skipping, click: toggleSkip, phone: true }
  ];

  function toggleFullscreen() {
    (fullscreenManager.fullscreenElement
      ? fullscreenManager.exitFullscreen()
      : fullscreenManager.requestFullscreen(document.documentElement)
    ).catch((error) => logger.warn(`Full screen failed: ${error.message}`));
  }

  /** Gamepad buttons (vn-gamepad.ts): the page's own actions here, the game's in the frame. */
  function padChange(pressed: PadAction[], released: PadAction[]) {
    const player = frame?.contentWindow as any;
    const { sheets, effects } = padStep(
      {
        more: showMore,
        backlog: showBacklog,
        tuning: showTuning,
        hooks: showHooks,
        saves: showSaves
      },
      pressed,
      released,
      { started, blocked: !!blocked }
    );

    ({ more: showMore, backlog: showBacklog, tuning: showTuning, hooks: showHooks } = sheets);
    for (const effect of effects) {
      if (effect === 'skip') toggleSkip();
      else if (effect === 'fullscreen') toggleFullscreen();
      else if (effect === 'closeSaves') closeSaves();
      else player?.padButton?.(effect.button, effect.down);
    }
  }

  async function openStatistics() {
    await save().catch((error) => logger.warn(error.message));
    goto(`${pagePath}/statistics`);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      save();
      if (started) saveSync?.pushWindows();
    }
  }

  // VNBox's lazyfs posts its load errors (a full storage quota above all): without them the
  // player just stays black.
  function frameMessage(event: MessageEvent) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
    if (event.data?.type === 'vnbox-error' && event.data.source === 'lazyfs') {
      blocked = vnboxErrorText(String(event.data.message ?? ''));
    }
  }

  onMount(() => {
    load(Number($page.url.searchParams.get('id'))).catch((error) =>
      logger.error(`Error loading visual novel: ${error.message}`)
    );
    // The frame hides the pads from its engine (overlay.js) but can still read them.
    return watchGamepads(
      () => [
        ...(navigator.getGamepads?.() ?? []),
        ...((frame?.contentWindow as any)?.framePads?.() ?? [])
      ],
      {
        change: padChange,
        cursor: (dx, dy, ms) => (frame?.contentWindow as any)?.padMove?.(dx, dy, ms)
      }
    );
  });

  onDestroy(() => {
    save();
    if (started) saveSync?.pushWindows();
    readingActivity();
    if (book && reading && isPluginEnabled('social')) {
      noteReading(book.title, reading.read.characters, book.characters, true, 'vn');
    }
    if (hookUrl) URL.revokeObjectURL(hookUrl);
  });
</script>

<svelte:window on:message={frameMessage} />

<svelte:head>
  <title>{formatPageTitle(book?.title ?? '')}</title>
</svelte:head>

<svelte:document on:visibilitychange={onVisibilityChange} />

<div class="vn-page fixed inset-0 flex flex-col">
  <VnBar
    title={book?.title ?? ''}
    place="Visual novel{book?.characters ? ` · ${Math.floor(percent)}%` : ''}"
    {chips}
    showText={$showText$}
    {showMore}
    onback={leave}
    ontext={() => showText$.next(!$showText$)}
    onfullscreen={toggleFullscreen}
    onmore={() => (showMore = !showMore)}
  />

  {#if keepAsk}
    <div class="vn-keep">
      <p>
        This game is {keepAsk.size}. Keep its files in this browser so it starts quickly next time?
      </p>
      <button class="app-button app-button-quiet" on:click={() => keepAsk?.answer(false)}>
        Not now
      </button>
      <button class="app-button app-button-primary" on:click={() => keepAsk?.answer(true)}>
        Keep files
      </button>
    </div>
  {/if}

  <div class="vn-main" class:vn-main-text={$showText$ && !ended}>
    {#if playerUrl && !showSaves}
      <VnRail
        railOpen={railOpen$}
        {skipping}
        {skipTitle}
        onmenu={openMenu}
        onskip={toggleSkip}
        onfullscreen={toggleFullscreen}
      />
    {/if}
    <!-- The game's own dark ground: part of the content, not the theme -->
    <div class="vn-game" class:vn-game-blocked={blocked || showSaves}>
      {#if blocked}
        <div class="vn-blocked" role="status">
          <p class="vn-blocked-title">This game can't start here</p>
          <p>{blocked}</p>
          <div class="flex flex-wrap gap-2">
            {#if missingFiles}
              <button class="app-button app-button-primary" on:click={addGameFolder}>
                Add the game files
              </button>
            {/if}
            <button class="app-button" on:click={leave}>Back to the library</button>
          </div>
        </div>
      {:else if showSaves}
        <div class="vn-blocked" role="status"><p>The game is stopped while Saves is open.</p></div>
      {:else if book && playerUrl}
        <AnkiWatcher media={ankiMedia} />
        {#key restarts}
          <iframe
            bind:this={frame}
            class="h-full w-full border-0"
            src={playerUrl}
            title={book.title}
            allow="autoplay; fullscreen"
            on:load={() => {
              if (frame) lookupPopup?.attachFrame(frame);
              frame?.contentDocument?.documentElement.style.setProperty(
                '--accent-color',
                getComputedStyle(document.documentElement).getPropertyValue('--accent-color')
              );
              frameLoaded = true;
              start().catch((error) => logger.error(`Error starting game: ${error.message}`));
            }}
          />
        {/key}
      {/if}
    </div>

    <VnSide
      bind:newerEngine
      {engineVersion}
      bind:savesNote
      {ended}
      showText={$showText$}
      {lines}
      characters={book?.characters}
      {readCharacters}
      {todayCharacters}
      {percent}
      ontap={(x, y) => lookupPopup?.tapAt(x, y)}
    />
  </div>
</div>

<LookupPopup bind:this={lookupPopup} scope=".vn-text" />

{#if showMore}
  <ReaderSheet title="More" on:close={() => (showMore = false)}>
    {#if windows && !blocked && (info?.discs?.length ?? 0) > 1}
      <VnboxDiscs count={info?.discs?.length ?? 0} {frame} />
    {/if}
    <ReaderMoreList items={moreList} />
  </ReaderSheet>
{/if}

{#if showTuning}
  <ReaderSheet title="Tuning" on:close={() => (showTuning = false)}>
    <VnboxTuning {tuning} {frame} onapply={applyTuning} />
  </ReaderSheet>
{/if}

{#if showBacklog}
  <ReaderSheet title="Backlog" on:close={() => (showBacklog = false)}>
    <VnBacklog {frame} keeping={$ankiEnabled$} ontap={(x, y) => lookupPopup?.tapAt(x, y)} />
  </ReaderSheet>
{/if}

{#if showSaves && book && info}
  <ReaderSheet title="Saves" on:close={closeSaves}>
    <VnSavesSheet
      areas={vnSaveAreas(book.title, info)}
      title={book.title}
      ondelete={(area, paths) => saveSync?.deleted(area, paths)}
    />
  </ReaderSheet>
{/if}

{#if showHooks && book}
  <ReaderSheet title="Hooks" on:close={() => (showHooks = false)}>
    <VnboxHooks
      {frame}
      bookId={book.id}
      cleanup={hookCleanup}
      oncleanup={(next) => (hookCleanup = next)}
    />
  </ReaderSheet>
{/if}

<style>
  .vn-page {
    background: var(--reader-panel-bg);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
  }

  @media (orientation: portrait) and (max-width: 767px) {
    /* The game at its width (most are 4:3), the text panel in the rest of the height */
    .vn-main-text .vn-game {
      height: 75vw;
      flex: none;
      padding: 0;
    }
  }

  /* The rail (vn-rail.svelte) beside the game. */
  @media (pointer: coarse) and (orientation: landscape) {
    .vn-main {
      position: relative;
    }

    .vn-main :global(.vn-rail-open ~ .vn-game) {
      margin-left: 5rem;
    }

    .vn-main :global(.vn-rail:not(.vn-rail-open) ~ .vn-game) {
      margin-left: 2.25rem;
    }
  }

  .vn-keep {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1.25rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    font-size: var(--type-body);
  }

  .vn-keep p {
    flex: 1;
  }

  .vn-main {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .vn-game {
    min-height: 0;
    flex: 1;
    padding: 1.5rem 0;
    background: #000;
  }

  /* No game to show: the page's own paper instead of the game's dark ground. */
  .vn-game-blocked {
    background: none;
  }

  .vn-blocked {
    display: flex;
    height: 100%;
    max-width: 32rem;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1rem;
    margin: 0 auto;
    padding: 0 1.25rem;
    color: var(--reader-panel-fg);
    font-size: var(--type-body);
    line-height: 1.7;
  }

  .vn-blocked-title {
    font-size: var(--type-h2);
    line-height: 1.3;
  }

  /* Phones held sideways: the text beside the game, the progress under it (vn-side.svelte) */
  @media (orientation: landscape) and (max-height: 500px) {
    .vn-game {
      padding: 0;
    }

    .vn-main-text {
      flex-direction: row;
    }
  }
</style>
