<script lang="ts">
  /**
   * Visual novel player (ONScripter games, not part of upstream): the engine runs in a
   * same-origin frame (static/vn/player.html); its text hook sends every page's text here
   * with where each character was drawn: laid invisibly over the game for Yomitan (and
   * optionally shown in a panel below it), and counted for progress and statistics. Saves of
   * Calibre games sync through vnsaves.json in the reader's sync folder.
   */
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
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
    decodeText,
    encodePath,
    fromBase64,
    hashPage,
    loadVnRead,
    mergeVnSaves,
    newerSaveEngine,
    newText,
    overlayLines,
    vnCacheName,
    parseVnPage,
    sameVnSaves,
    saveVnRead,
    toBase64,
    vnBookmark,
    vnInfo,
    type VnLine,
    type VnRead,
    type VnSaves
  } from '$lib/data/vn';
  import { accountReady } from '$lib/data/account';
  import { recordKanjiText } from '$lib/data/kanji-seen';
  import { countTextCharacters } from '$lib/functions/get-character-count';
  import { CalibreStorageHandler } from '$lib/data/storage/handler/calibre-handler';
  import type {
    BooksDbBookData,
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
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
  import { getDateKey } from '$lib/functions/statistic-util';
  import {
    getDefaultStatistic,
    updateStatistic
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import AnkiWatcher from '$lib/components/anki-watcher.svelte';
  import {
    ankiEnabled$,
    ankiSentenceField$,
    ankiVnAudio$,
    ankiVnScreenshot$,
    noteSentence,
    vnLineFor,
    type AnkiNote
  } from '$lib/data/anki';
  import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';

  /** Time between two clicks counted as reading at most, so breaks don't count. */
  const maxSecondsPerPage = 120;
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
  let lines: VnLine[] = [];
  let ended = false;
  let read: VnRead;
  let seen = new Set<string>();
  let previousText = '';
  /** Read since the last save, for "Kanji met" */
  let unsavedText = '';
  let lastTextTime = 0;
  /** CONscripter version of this build, stamped on uploaded saves. */
  let engineVersion: string | undefined;
  /** Set when synced saves were written by a newer engine than this one. */
  let newerEngine: string | undefined;
  let statistics = new Map<string, BooksDbStatistic>();
  let changedDays = new Set<string>();
  let dirty = false;
  let local: BrowserStorageHandler;
  let external: BaseStorageHandler | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let savesQueue = Promise.resolve();
  let started = false;
  /** A server game over 10 MB asks before its files are kept in the browser. */
  let keepAsk: { size: string; answer: (keep: boolean) => void } | undefined;
  let showMore = false;
  /** The engine's skip mode, as it reports it (consMode) */
  let skipping = false;
  /** For the progress line: characters read, and today */
  let readCharacters = 0;
  let todayCharacters = 0;

  $: percent = book?.characters ? Math.min(100, (readCharacters / book.characters) * 100) : 0;

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

    read = await loadVnRead(data.title);
    seen = new Set(read.pages);

    // Another device may be further along: keep the larger position.
    const bookmark = await database.getBookmark(data.id);

    read.characters = Math.max(read.characters, bookmark?.exploredCharCount || 0);
    statistics = new Map(
      (await database.getStatisticsForBook(data.title)).map((stat) => [stat.dateKey, stat])
    );
    updateProgress();
  }

  function updateProgress() {
    readCharacters = read.characters;
    todayCharacters =
      statistics.get(getDateKey($startDayHoursForTracker$, new Date()))?.charactersRead ?? 0;
  }

  function savesUrl() {
    return book?.storageSource === StorageSourceDefault.CALIBRE_DEFAULT
      ? CalibreStorageHandler.syncFileUrl(book.title, 'vnsaves.json')
      : undefined;
  }

  async function fetchSaves(): Promise<VnSaves> {
    const url = savesUrl();

    if (!url) return {};

    await accountReady();

    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);

    return response.ok ? response.json() : {};
  }

  /** After the engine saved: merges this browser's saves into the synced ones. */
  function uploadSaves(files: Record<string, { modified: number; bytes: Uint8Array }>) {
    const url = savesUrl();

    if (!url) return;

    const local: VnSaves = Object.fromEntries(
      Object.entries(files).map(([name, file]) => [
        name,
        { modified: file.modified, data: toBase64(file.bytes), engine: engineVersion }
      ])
    );

    savesQueue = savesQueue
      .then(async () => {
        const remote = await fetchSaves();
        const merged = mergeVnSaves(local, remote);

        if (!sameVnSaves(merged, remote)) {
          const put = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(merged)
          });

          if (!put.ok) throw new Error(`upload failed (HTTP ${put.status})`);
        }
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
    if (!book || !frame?.contentWindow) return;

    const info = vnInfo(book);
    const player = frame.contentWindow as any;

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

    lastTextTime = Date.now();
    await player.startGame({
      // Server folder games are fetched by URL; imported ones are blobs.
      files: info.base
        ? Object.fromEntries(info.files.map((path) => [path, `${info.base}${encodePath(path)}`]))
        : book.blobs,
      cacheName,
      keepLines: $ankiEnabled$,
      recordLines: $ankiEnabled$ && $ankiVnAudio$,
      encoding: info.encoding,
      saveDir: `/save/${hashPage(book.title)}`,
      saves: Object.fromEntries(
        Object.entries(saves).map(([name, file]) => [
          name,
          { modified: file.modified, bytes: fromBase64(file.data) }
        ])
      ),
      onText: (bytes: Uint8Array, skipped: number, boxes: Int32Array, readBefore: number) => {
        player.showText(overlayLines(bytes, boxes, info.encoding));
        onText(decodeText(bytes, info.encoding), !!skipped, readBefore === 1);
      },
      textLines: (bytes: Uint8Array, boxes: Int32Array) =>
        overlayLines(bytes, boxes, info.encoding),
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
    const now = Date.now();

    lines = parseVnPage(text);

    if (!skipped) {
      const added = newText(previousText, text, seen, readBefore);
      const characters = countTextCharacters(added);
      const seconds = Math.min((now - lastTextTime) / 1000, maxSecondsPerPage);

      if (characters) {
        read.characters += characters;
        unsavedText += added;
        dirty = true;
      }

      if ($statisticsEnabled$ && (characters || seconds >= 1)) {
        const day = getDateKey($startDayHoursForTracker$, new Date(now));
        const stat = statistics.get(day) ?? getDefaultStatistic(book!.title, day);

        statistics.set(day, updateStatistic(stat, Math.round(seconds), characters, now));
        changedDays.add(day);
        dirty = true;
      }
    }

    previousText = text;
    lastTextTime = now;
    updateProgress();

    if (dirty) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 3000);
    }
  }

  async function save() {
    clearTimeout(saveTimer);

    if (!dirty || !book) return;

    dirty = false;

    const days = [...changedDays];
    const text = unsavedText;

    unsavedText = '';

    changedDays = new Set();
    await saveVnRead({ ...read, pages: [...seen] });
    await recordKanjiText(book.title, text, read.characters);
    await database.putBookmark(vnBookmark(book.id, read.characters, book.characters));

    const types = [StorageDataType.PROGRESS];

    if (days.length) {
      await database.storeStatistics(
        book.title,
        days.map((day) => statistics.get(day)!),
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

  function openMenu() {
    (frame?.contentWindow as any)?.openMenu();
  }

  /** Toggles in the bar, and on portrait phones in a row under it; Menu and Skip only on phones. */
  $: chips = [
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
    { label: 'Menu', title: "The game's menu (right-click)", on: undefined, click: openMenu, phone: true },
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
    <div class="vn-game">
      {#if book}
        <AnkiWatcher media={ankiMedia} />
        <iframe
          bind:this={frame}
          class="h-full w-full border-0"
          src="{pagePath}/vn/player.html"
          title={book.title}
          allow="autoplay; fullscreen"
          on:load={() =>
            start().catch((error) => logger.error(`Error starting game: ${error.message}`))}
        />
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
        <div class="vn-text" lang="ja">
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
      <li><button on:click={openStatistics}>Statistics</button></li>
    </ul>
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
    flex: none;
    align-items: center;
    justify-content: center;
    padding: 0 0.75rem;
    border-radius: 2px;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .vn-chip-icon {
    width: 2.75rem;
    margin-left: auto;
    padding: 0;
  }

  .vn-chip-on {
    background: color-mix(in srgb, var(--accent-color) 12%, var(--reader-panel-bg));
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

    .vn-main-text .vn-text {
      max-height: none;
      flex: 1;
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
    border-top: 2px solid var(--reader-panel-fg);
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 2;
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
