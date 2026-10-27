<script lang="ts">
  /**
   * Visual novel player (not part of upstream): the engine runs in a same-origin frame,
   * CONscripter for ONScripter games (static/vn/player.html) or VNBox for Windows games
   * (static/vn/vnbox.html, windows-game.ts); its text hook sends the text the game shows,
   * which the frame lays invisibly over the game for Yomitan and this page shows in a panel
   * below it (optional) and counts for progress and statistics (vn-text.ts). Saves of
   * ONScripter games on a synced source sync through vnsaves.json in the game's folder
   * (sync-files.ts).
   */
  import { noteReading } from '$lib/data/social';
  import { readingActivity } from '$lib/data/reader-hooks';
  import { isPluginEnabled } from '$lib/plugins';
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$lib/data/page-store';
  import Fa from 'svelte-fa';
  import { faEllipsis, faExpand } from '@fortawesome/free-solid-svg-icons';
  import PlayerBar from '$lib/components/player-bar.svelte';
  import ReaderSheet from '$lib/components/book-reader/reader-sheet.svelte';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import {
    autoReplication$,
    cacheStorageData$,
    database,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    startDayHoursForTracker$,
    statisticsEnabled$,
    statisticsMergeMode$,
    syncTarget$
  } from '$lib/data/store';
  import { pagePath } from '$lib/data/env';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import {
    encodePath,
    fromBase64,
    hashPage,
    loadVnRead,
    mergeVnSaves,
    newerSaveEngine,
    vnCacheName,
    parseVnPage,
    sameVnSaves,
    saveVnRead,
    toBase64,
    vnBookmark,
    vnInfo,
    type VnLine,
    type VnSaves
  } from '$lib/data/vn';
  import { VnReading, vnTextSource } from '$lib/data/vn-text';
  import {
    hasWindowsGame,
    loadVnboxTuning,
    saveVnboxTuning,
    vnboxPlayerUrl,
    windowsGameBlocker,
    windowsGameBlockerText
  } from '$lib/data/windows-game';
  import { bookSyncSource, syncFileStore, syncJsonFile } from '$lib/data/sync-files';
  import { recordKanjiText } from '$lib/data/kanji-seen';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
  import {
    StorageDataType,
    StorageKey,
    StorageSourceDefault
  } from '$lib/data/storage/storage-types';
  import {
    AutoReplicationType,
    ReplicationSaveBehavior
  } from '$lib/functions/replication/replication-options';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { vnFolderSize } from '$lib/functions/file-loaders/vn/load-vn';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import AnkiWatcher from '$lib/components/anki-watcher.svelte';
  import VnboxTuning from '$lib/components/vn/vnbox-tuning.svelte';
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

  /** The text panel below the game; hovering the game's own text works without it. */
  const showText$ = writableBooleanLocalStorageSubject()('vnTextPanel', false);
  /** Furigana drawn by the game; off, the readings are still in the overlay and text panel. */
  const furigana$ = writableBooleanLocalStorageSubject()('vnFurigana', true);
  /** The whole text at once instead of the game's text speed. */
  const instantText$ = writableBooleanLocalStorageSubject()('vnInstantText', false);
  const defaultSources: Record<string, StorageKey> = {
    [StorageSourceDefault.CALIBRE_DEFAULT]: StorageKey.CALIBRE,
    [StorageSourceDefault.GDRIVE_DEFAULT]: StorageKey.GDRIVE,
    [StorageSourceDefault.ONEDRIVE_DEFAULT]: StorageKey.ONEDRIVE
  };

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
  let savesQueue = Promise.resolve();
  let started = false;

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

  function handler(type: StorageKey, name?: string) {
    return getStorageHandler(
      window,
      type,
      name,
      true,
      $cacheStorageData$,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$
    );
  }

  /** Where this game's progress syncs, as in the book reader (Calibre always syncs). */
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
    local.startContext(context());
    data.lastBookOpen = Date.now();
    await local.updateLastRead(data);

    try {
      external = await externalHandler(data);

      if (external) {
        external.startContext(context());

        if (syncs(AutoReplicationType.Down)) {
          const error = await replicateData(
            external,
            local,
            false,
            [context()],
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

    const game = vnInfo(data);

    if (game.engine === 'vnbox') {
      // The OPFS game copy and VNBox's saves must not be evicted.
      navigator.storage?.persist?.();
      const blocker = windowsGameBlocker();

      blocked = blocker
        ? windowsGameBlockerText[blocker]
        : !(await hasWindowsGame(game.folder!))
          ? "This game's files aren't in this browser. Add its folder again with Import → Windows game."
          : undefined;
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

  function savesStore() {
    return syncFileStore(bookSyncSource(book?.storageSource));
  }

  async function fetchSaves(): Promise<VnSaves> {
    const store = book && (await savesStore());
    const file = store ? await store.readSyncFile('vnsaves.json', book!.title) : undefined;

    return file ? JSON.parse(file.text) : {};
  }

  /** After the engine saved: merges this browser's saves into the synced ones. */
  function uploadSaves(files: Record<string, { modified: number; bytes: Uint8Array }>) {
    const title = book?.title;

    if (!title) return;

    const local: VnSaves = Object.fromEntries(
      Object.entries(files).map(([name, file]) => [
        name,
        { modified: file.modified, data: toBase64(file.bytes), engine: engineVersion }
      ])
    );

    savesQueue = savesQueue
      .then(async () => {
        const store = await savesStore();

        if (!store) return;

        await syncJsonFile<VnSaves>(store, 'vnsaves.json', title, async (remote = {}) => {
          const merged = mergeVnSaves(local, remote);

          return sameVnSaves(merged, remote) ? undefined : merged;
        });
      })
      .catch((error) => logger.warn(`Visual novel save sync failed: ${error.message}`));
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
      reading.lastTextTime = Date.now();
      await player.startGame({
        keepLines: $ankiEnabled$,
        recordLines: $ankiEnabled$ && $ankiVnAudio$,
        textLines: source.textLines,
        onText: source.onText
      });
      started = true;
      return;
    }

    const saves = await fetchSaves().catch((error): VnSaves => {
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
      onSave: uploadSaves,
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
      const error = await replicateData(local, external!, false, [context()], types).catch(
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

  function openMenu() {
    (frame?.contentWindow as any)?.openMenu();
  }

  /** Toggles in the bar, and on portrait phones in a row under it; Menu and Skip only on phones. */
  $: chips = windows
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
        },
        {
          label: 'Menu',
          title: "The game's menu (right-click)",
          on: undefined,
          click: openMenu,
          phone: true
        },
        { label: 'Skip', title: 'Skip text', on: skipping, click: toggleSkip, phone: true }
      ];

  function toggleFullscreen() {
    if (fullscreenManager.fullscreenElement) fullscreenManager.exitFullscreen();
    else fullscreenManager.requestFullscreen(document.documentElement);
  }

  async function openStatistics() {
    await save().catch((error) => logger.warn(error.message));
    goto(`${pagePath}/statistics`);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') save();
  }

  onMount(() => {
    load(Number($page.url.searchParams.get('id'))).catch((error) =>
      logger.error(`Error loading visual novel: ${error.message}`)
    );
  });

  onDestroy(() => {
    save();
    readingActivity();
    if (book && reading && isPluginEnabled('social')) {
      noteReading(book.title, reading.read.characters, book.characters, true, 'vn');
    }
    if (hookUrl) URL.revokeObjectURL(hookUrl);
  });
</script>

<svelte:head>
  <title>{formatPageTitle(book?.title ?? '')}</title>
</svelte:head>

<svelte:document on:visibilitychange={onVisibilityChange} />

<div class="vn-page fixed inset-0 flex flex-col">
  <PlayerBar
    title={book?.title ?? ''}
    place="Visual novel{book?.characters ? ` · ${Math.floor(percent)}%` : ''}"
    on:back={leave}
  >
    {#each chips as chip}
      <button
        class="bar-text bar-chip vn-bar-chip"
        class:vn-phone-chip={chip.phone}
        class:bar-icon-active={chip.on}
        title={chip.title}
        aria-pressed={chip.on}
        on:click={chip.click}
      >
        {chip.label}
      </button>
    {/each}
    <span class="bar-divider vn-bar-chip" aria-hidden="true" />
    <button
      class="bar-icon"
      class:bar-icon-active={$showText$}
      title="Show the text beside the game"
      aria-pressed={$showText$}
      on:click={() => showText$.next(!$showText$)}
    >
      <!-- A screen with a text panel under it -->
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <rect
          x="2.75"
          y="3.75"
          width="14.5"
          height="12.5"
          rx="1"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
        <path d="M3 12h14" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
    {#if fullscreenManager.fullscreenEnabled}
      <button class="bar-icon vn-bar-chip" title="Full screen" on:click={toggleFullscreen}>
        <Fa icon={faExpand} />
      </button>
    {/if}
    <button
      class="bar-icon"
      class:bar-icon-active={showMore}
      title="More"
      aria-expanded={showMore}
      on:click={() => (showMore = !showMore)}
    >
      <Fa icon={faEllipsis} />
    </button>
  </PlayerBar>

  <div class="vn-chip-row">
    {#each chips as chip}
      <button
        class="vn-chip"
        class:vn-chip-on={chip.on}
        title={chip.title}
        aria-pressed={chip.on}
        on:click={chip.click}
      >
        {chip.label}
      </button>
    {/each}
    {#if fullscreenManager.fullscreenEnabled}
      <button class="vn-chip vn-chip-icon" title="Full screen" on:click={toggleFullscreen}>
        <Fa icon={faExpand} />
      </button>
    {/if}
  </div>

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
    <!-- The game's own dark ground: part of the content, not the theme -->
    <div class="vn-game" class:vn-game-blocked={blocked}>
      {#if blocked}
        <div class="vn-blocked" role="status">
          <p class="vn-blocked-title">This game can't start here</p>
          <p>{blocked}</p>
          <button class="app-button" on:click={leave}>Back to the library</button>
        </div>
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

    <div class="vn-side">
      {#if newerEngine}
        <div class="vn-notice">
          <p>
            Some saves were made with a newer engine (CONscripter {newerEngine}) than this server's
            ({engineVersion}). They will most likely still load; if one doesn't, ask an admin to
            update the engine.
          </p>
          <button class="app-button app-button-quiet" on:click={() => (newerEngine = undefined)}>
            Dismiss
          </button>
        </div>
      {/if}

      {#if ended}
        <p class="vn-text">The game has ended.</p>
      {:else if $showText$}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <div
          class="vn-text"
          class:vn-text-ruled={lines.length}
          lang="ja"
          on:click={(event) => lookupPopup?.tapAt(event.clientX, event.clientY)}
        >
          {#each lines as line}
            <p>
              {#each line as part}{#if part.ruby}<ruby>{part.text}<rt>{part.ruby}</rt></ruby
                  >{:else}{part.text}{/if}{/each}
            </p>
          {/each}
        </div>
      {/if}

      {#if book?.characters}
        <div class="vn-progress">
          <span class="vn-progress-track">
            <span class="vn-progress-fill" style:width="{percent}%" />
          </span>
          <span class="vn-progress-label">
            {readCharacters.toLocaleString('en')} / {book.characters.toLocaleString('en')} chars ·
            {Math.floor(percent)}%
            {#if todayCharacters}
              <span class="vn-today">+{todayCharacters.toLocaleString('en')} today</span>
            {/if}
          </span>
        </div>
      {/if}
    </div>
  </div>
</div>

<LookupPopup bind:this={lookupPopup} scope=".vn-text" />

{#if showMore}
  <ReaderSheet title="More" on:close={() => (showMore = false)}>
    <ul class="vn-more">
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
      {#if windows && !blocked}
        <li>
          <button
            on:click={() => {
              showMore = false;
              showTuning = true;
            }}
          >
            Tuning
          </button>
        </li>
      {/if}
      <li><button on:click={openStatistics}>Statistics</button></li>
    </ul>
  </ReaderSheet>
{/if}

{#if showTuning}
  <ReaderSheet title="Tuning" on:close={() => (showTuning = false)}>
    <VnboxTuning {tuning} {frame} onapply={applyTuning} />
  </ReaderSheet>
{/if}

<style>
  .vn-page {
    background: var(--reader-panel-bg);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
  }

  /* Menu and Skip are for phones, where right-click and the game's own buttons are hard to reach. */
  .vn-page .vn-phone-chip,
  .vn-chip-row {
    display: none;
  }

  .vn-chip-row {
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .vn-chip {
    display: inline-flex;
    height: 2.75rem;
    flex: 1 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border-radius: 2px;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .vn-chip-icon {
    width: 2.75rem;
    flex: none;
    padding: 0;
  }

  .vn-chip-on {
    background: var(--app-spot-tint);
    color: var(--accent-strong-color);
  }

  @media (orientation: portrait) and (max-width: 767px) {
    .vn-page .vn-bar-chip {
      display: none;
    }

    .vn-chip-row {
      display: flex;
    }

    /* The game at its width (most are 4:3), the text panel in the rest of the height */
    .vn-main-text .vn-game {
      height: 75vw;
      flex: none;
      padding: 0;
    }

    .vn-main-text .vn-side {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
    }

    /* The text at body size, as tall as it is; the progress stays at the bottom */
    .vn-main-text .vn-text {
      max-height: none;
      font-size: var(--type-body);
      font-weight: 400;
      line-height: 1.8;
    }

    .vn-main-text .vn-progress {
      margin-top: auto;
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    .vn-page .vn-phone-chip {
      display: inline-flex;
    }

    .vn-page .bar-chip {
      height: 2.75rem;
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

  .vn-notice {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.6rem 1.25rem;
    background: var(--surface-color);
    font-size: var(--type-small);
  }

  .vn-notice p {
    flex: 1;
  }

  .vn-text {
    width: min(50rem, calc(100% - 2.5rem));
    max-height: 30vh;
    margin: 1.75rem auto 0;
    overflow-y: auto;
    padding-top: 0.75rem;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 2;
  }

  .vn-text-ruled {
    border-top: 2px solid var(--reader-panel-fg);
  }

  .vn-text p {
    margin: 0;
    min-height: 1em;
  }

  .vn-progress {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
  }

  .vn-progress-track {
    position: relative;
    height: 3px;
    flex: 1;
    background: var(--app-progress-track);
  }

  .vn-progress-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-color);
  }

  .vn-progress-label {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .vn-today {
    margin-left: 0.5rem;
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  /* Phones held sideways: the text beside the game, the progress under it */
  @media (orientation: landscape) and (max-height: 500px) {
    .vn-game {
      padding: 0;
    }

    .vn-main-text {
      flex-direction: row;
    }

    .vn-main-text .vn-side {
      display: flex;
      width: 40%;
      flex-direction: column;
      border-left: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    }

    .vn-main-text .vn-text {
      max-height: none;
      flex: 1;
      margin-top: 1rem;
    }

    .vn-main-text .vn-progress {
      flex-wrap: wrap;
      padding: 0.75rem 1rem;
    }

    .vn-main-text .vn-progress-track {
      flex-basis: 100%;
    }

    .vn-progress {
      padding: 0.4rem 1rem;
    }
  }

  .vn-more {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .vn-more button {
    display: flex;
    width: 100%;
    min-height: 3.25rem;
    align-items: center;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    text-align: left;
  }

  .vn-more button:hover {
    color: var(--accent-strong-color);
  }
</style>
