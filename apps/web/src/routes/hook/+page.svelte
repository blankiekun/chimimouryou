<script lang="ts">
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import LookupPopup from '$lib/components/dictionary/lookup-popup.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import { formatDuration, localNetworkDenied } from '$lib/data/discord/discord';
  import { pagePath } from '$lib/data/env';
  import { addImmersionTime } from '$lib/data/stats/immersion-log';
  import { logger } from '$lib/data/logger';
  import { readingActivity } from '$lib/data/reader/reader-hooks';
  import { statisticsEnabled$, trackerIdleTime$ } from '$lib/data/store';
  import {
    hookPresets,
    hookSocketUrl$,
    hookTitle$,
    isSocketUrl,
    lineCount,
    loadLines,
    maxLines,
    parseHookMessage,
    saveLines,
    type HookLine
  } from '$lib/data/vn/texthooker';
  import NativeGameDialog from '$lib/components/vn/native-game-dialog.svelte';
  import NativeThreads from '$lib/components/vn/native-threads.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { page } from '$lib/data/page-store';
  import { database } from '$lib/data/store';
  import { hookCleaner } from '$lib/data/vn/hook-cleanup';
  import {
    desktopGames,
    isSavedThread,
    nativeSavesToPull,
    NativeThreads as Threads,
    pushNativeSaves,
    type NativeHook,
    type NativeMessage,
    type NativeThread
  } from '$lib/data/vn/native-games';
  import { vnElementHtml, vnInfo } from '$lib/data/vn/vn';
  import { VnSaveSync } from '$lib/data/vn/vn-save-store';
  import { rankThreads } from '$lib/data/vn/windows-game';
  import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { t$, type MessageKey } from '$lib/i18n';
  import { onDestroy, onMount, tick } from 'svelte';

  /**
   * The texthooker: game text from Textractor, LunaTranslator or agent over a WebSocket on this
   * computer, or pasted, as a list for Yomitan and the built-in lookups. Characters and time go
   * to the immersion log; the lines stay in this browser.
   * `?native=<book id>` (desktop app): the library's Windows game played natively, its lines from
   * the app's built-in hook (native-games.ts) on the thread picked here instead of a WebSocket.
   */

  type Status = 'connecting' | 'connected' | 'closed' | 'blocked' | 'invalid' | 'off';

  const statusLabels: Record<Status, MessageKey> = {
    connecting: 'hook.status.connecting',
    connected: 'hook.status.connected',
    closed: 'hook.status.closed',
    blocked: 'hook.status.blocked',
    invalid: 'hook.status.invalid',
    off: 'hook.status.off'
  };
  let url = $state(hookSocketUrl$.getValue());
  let title = $state(hookTitle$.getValue());
  let status = $state<Status>('off');
  let lines = $state<HookLine[]>(loadLines());
  const opened = Date.now();
  let sessionCharacters = $state(0);
  let sessionSeconds = $state(0);
  let list = $state<HTMLOListElement>();
  let lookupPopup = $state<LookupPopup>();

  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 2000;

  const gameTitle = () => title.trim() || 'Texthooker';

  // Set on mount: the address can't be read while prerendering.
  let nativeId = $state<number>();
  const games = desktopGames();
  let nativeHook = $state<NativeHook>();
  let nativeStatus = $state('Starting the game…');
  let nativeRunning = $state(false);
  let ranked = $state<{ thread: NativeThread; score: number }[]>([]);
  let threads = new Threads();
  let cleanup = {};
  let clean = hookCleaner({});
  let stopListening: (() => void) | undefined;
  /** vnsaves.json, shared with VNBox: pulled before the game starts, pushed when it closes. */
  let saveSync: VnSaveSync | undefined;
  let saveStamp: string | undefined;
  let saveNote = $state<string>();
  /** Windows: folders the game's first run wrote, to confirm as its saves */
  let pendingFolders = $state<string[]>();

  /** Starts the game (or rejoins the one running), asking for its folder when it isn't linked. */
  async function startNative() {
    const book = await database.getData(nativeId!);

    if (!book || !games) {
      nativeStatus = 'This game isn’t in this library.';
      return;
    }
    const info = vnInfo(book);

    title = book.title;
    saveSync = new VnSaveSync(book.title, info, book.storageSource, () => {});
    nativeHook = info.nativeHook;
    cleanup = info.hookCleanup ?? {};
    clean = hookCleaner(cleanup);
    stopListening ??= games.onHook(onNative);

    const session = await games.session();

    if (session && session.folder === info.folder && session.running) {
      nativeRunning = true;
      nativeStatus = 'Playing.';
      session.messages.forEach((message) => onNative(message, true));
      return;
    }
    threads = new Threads();
    ranked = [];
    nativeStatus = 'Starting the game…';

    const result = await games.launch(info.folder!, await nativeSavesToPull(saveSync));

    if (result.status === 'started') {
      nativeRunning = true;
      nativeStatus = 'Starting the game…';
    } else if (result.status === 'missing' || result.status === 'gone') {
      nativeStatus = 'Waiting for the game’s folder.';
      dialogManager.dialogs$.next([
        {
          component: NativeGameDialog as any,
          props: {
            title: book.title,
            folder: info.folder,
            exe: info.exe,
            gone: result.status === 'gone' ? result.path : undefined,
            done: startNative
          },
          disableCloseOnClick: true
        }
      ]);
    } else {
      nativeStatus =
        result.status === 'running'
          ? `${result.title} is running: close it first.`
          : result.status === 'error'
            ? result.message
            : 'This build of the app can’t play games natively.';
    }
  }

  /** A message from the built-in hook; `replayed` ones (from before this page) add no stats. */
  function onNative(message: NativeMessage, replayed = false) {
    if (message.type === 'status') nativeStatus = message.text;
    else if (message.type === 'error') nativeStatus = message.message;
    else if (message.type === 'inject')
      nativeStatus = message.ok ? 'Playing.' : 'The text hook couldn’t attach to the game.';
    else if (message.type === 'exit') {
      nativeRunning = false;
      nativeStatus = 'The game has closed.';
      if (!replayed) pushSaves();
    } else if (message.type === 'text') {
      const thread = threads.add(message.thread, message.sentence, Date.now());

      ranked = rankThreads([...threads.threads.values()], cleanup) as typeof ranked;
      if (!replayed && isSavedThread(thread, nativeHook)) {
        addLine(clean(message.sentence, thread.hookcode).trim());
      }
    }
  }

  async function pushSaves() {
    if (!games || !saveSync?.info.folder) return;
    try {
      const pushed = await pushNativeSaves(games, saveSync.info.folder, saveSync, saveStamp);

      saveStamp = pushed.stamp;
      saveNote = pushed.note;
      pendingFolders = pushed.pending;
    } catch (error: any) {
      logger.warn(`Visual novel save sync failed: ${error.message}`);
    }
  }

  async function confirmFolders(keep: boolean) {
    pendingFolders = undefined;
    await games?.saveFolders(saveSync!.info.folder!, keep);
    if (keep) await pushSaves();
  }

  /** Lines come from this thread's hook from now on; saved on the record for every device. */
  async function pickThread(thread: NativeThread) {
    const hook = { hookcode: thread.hookcode, name: thread.label ?? thread.hookcode };

    nativeHook = hook;
    const stored = await database.getData(nativeId!);

    if (!stored) return;
    await database.upsertData(
      { ...stored, elementHtml: vnElementHtml({ ...vnInfo(stored), nativeHook: hook }) },
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );
  }

  function connect() {
    disconnect();
    hookSocketUrl$.next(url);
    if (!isSocketUrl(url)) {
      status = 'invalid';
      return;
    }

    let ws: WebSocket;

    status = 'connecting';
    try {
      ws = new WebSocket(url);
    } catch {
      status = 'invalid';
      return;
    }
    socket = ws;
    ws.onopen = () => {
      status = 'connected';
      retryDelay = 2000;
    };
    ws.onmessage = (event) => addLine(parseHookMessage(event.data));
    ws.onclose = async () => {
      if (socket !== ws) return;
      socket = undefined;
      status = (await localNetworkDenied()) ? 'blocked' : 'closed';
      // The tool may start later: keep trying quietly.
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };
  }

  function disconnect() {
    clearTimeout(retryTimer);
    const ws = socket;

    socket = undefined;
    ws?.close();
    status = 'off';
  }

  function addLine(text: string) {
    if (!text) return;

    const now = Date.now();
    const count = lineCount(text, lines.at(-1), now, $trackerIdleTime$, opened);

    if (count.repeat) return;

    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80;

    lines = [...lines, { id: `${now}-${lines.length}`, text, at: now }].slice(-maxLines);
    saveLines(lines);
    sessionCharacters += count.characters;
    sessionSeconds += count.seconds;
    // Each line at once: a closed tab loses nothing.
    if ($statisticsEnabled$) {
      addImmersionTime('hook', 'vn', gameTitle(), count.seconds, count.characters).catch((error) =>
        logger.warn(`Couldn't save to the immersion log: ${error.message}`)
      );
    }
    readingActivity({ kind: 'vn', title: gameTitle(), position: sessionCharacters });

    if (atBottom) {
      tick().then(() => list && (list.scrollTop = list.scrollHeight));
    }
  }

  function onPaste(event: ClipboardEvent) {
    const target = event.target as HTMLElement | null;

    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    addLine(event.clipboardData?.getData('text/plain').trim() ?? '');
  }

  async function pasteButton() {
    try {
      addLine((await navigator.clipboard.readText()).trim());
    } catch {
      // Clipboard reading refused: Ctrl+V on the page still works
    }
  }

  function clearLines() {
    lines = [];
    saveLines([]);
  }

  function saveTitle() {
    hookTitle$.next(title.trim());
  }

  onMount(() => {
    nativeId = (games && Number($page.url.searchParams.get('native'))) || undefined;
    if (nativeId) startNative().catch((error) => (nativeStatus = error.message));
    else connect();
    if (list) list.scrollTop = list.scrollHeight;
  });

  onDestroy(() => {
    stopListening?.();
    disconnect();
    readingActivity();
  });
</script>

<svelte:head>
  <title>{formatPageTitle($t$('hook.title'))}</title>
</svelte:head>

<svelte:window onpaste={onPaste} />

<AppHeader active="profile" />

<div class="app-page-shell">
  <main class="hook">
    <header class="hook-head">
      <h1 class="hook-title">{$t$('hook.title')}</h1>
      <p class="hook-subtitle">{$t$('hook.subtitle')}</p>
    </header>

    <div class="hook-top">
      <PointBox label={$t$('hook.session')} figure={sessionCharacters} unit={$t$('dashboard.unit')}>
        <p class="hook-session">
          {formatDuration(sessionSeconds) || $t$('hook.underMinute')} ·
          <a href="{pagePath}/statistics">{$t$('hook.toLog')}</a>
        </p>
        {#if !$statisticsEnabled$}
          <p class="hook-hint">{$t$('hook.statisticsOff')}</p>
        {/if}
      </PointBox>

      {#if nativeId}
        <div class="hook-settings">
          <p class="hook-game" lang="ja">{title}</p>
          <div class="hook-actions">
            <span class="hook-status" class:hook-status-on={nativeRunning} role="status">
              {nativeStatus}
            </span>
            {#if !nativeRunning}
              <button type="button" class="app-button" onclick={() => startNative()}>
                Start the game
              </button>
            {/if}
          </div>
          {#if saveNote}
            <p class="hook-hint" role="status">{saveNote}</p>
          {/if}
          {#if pendingFolders?.length}
            <div class="hook-hint" role="group" aria-label="Save folders">
              <p>The game wrote into these folders. Sync them as its saves?</p>
              <ul>
                {#each pendingFolders as folder (folder)}
                  <li>{folder.replace(/^wine\/drive_c\/(users\/username\/)?/, '')}</li>
                {/each}
              </ul>
              <button type="button" class="app-button" onclick={() => confirmFolders(true)}>
                Sync these
              </button>
              <button type="button" class="app-button" onclick={() => confirmFolders(false)}>
                They aren’t saves
              </button>
            </div>
          {/if}
          <NativeThreads {ranked} hook={nativeHook} onpick={pickThread} />
        </div>
      {:else}
        <form
          class="hook-settings"
          onsubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <label class="hook-field">
            <span>{$t$('hook.game')}</span>
            <input
              class="app-input"
              bind:value={title}
              placeholder="Texthooker"
              onchange={saveTitle}
              lang="ja"
            />
          </label>
          <label class="hook-field">
            <span>{$t$('hook.address')}</span>
            <input class="app-input" bind:value={url} spellcheck="false" list="hook-presets" />
            <datalist id="hook-presets">
              {#each hookPresets as preset (preset.url)}
                <option value={preset.url}>{preset.label}</option>
              {/each}
            </datalist>
          </label>
          <div class="hook-actions">
            <span class="hook-status" class:hook-status-on={status === 'connected'} role="status">
              {$t$(statusLabels[status])}
            </span>
            {#if status !== 'off' && status !== 'invalid'}
              <button type="button" class="app-button app-button-quiet" onclick={disconnect}>
                {$t$('hook.disconnect')}
              </button>
            {/if}
            <button type="submit" class="app-button">{$t$('hook.connect')}</button>
          </div>
        </form>
      {/if}
    </div>

    <div class="hook-bar">
      <span class="hook-count">{$t$('hook.lines', { count: lines.length })}</span>
      <button type="button" class="app-button app-button-quiet" onclick={pasteButton}>
        {$t$('hook.paste')}
      </button>
      <button
        type="button"
        class="app-button app-button-quiet"
        onclick={clearLines}
        disabled={!lines.length}
      >
        {$t$('hook.clear')}
      </button>
    </div>

    {#if lines.length}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <ol
        class="hook-text"
        lang="ja"
        bind:this={list}
        onclick={(event) => lookupPopup?.tapAt(event.clientX, event.clientY)}
      >
        {#each lines as line (line.id)}
          <li>{line.text}</li>
        {/each}
      </ol>
    {:else}
      <p class="hook-empty">{$t$('hook.empty')}</p>
    {/if}
  </main>
</div>

<LookupPopup bind:this={lookupPopup} scope=".hook-text" />

<style>
  .hook {
    display: flex;
    max-width: 60rem;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }

  .hook-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .hook-subtitle,
  .hook-hint,
  .hook-empty {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hook-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.5rem;
  }

  @media (min-width: 800px) {
    .hook-top {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
      align-items: start;
    }
  }

  .hook-session {
    margin-top: 0.5rem;
    font-size: var(--type-small);
  }

  .hook-session a {
    color: var(--accent-color);
    text-decoration: underline;
  }

  .hook-settings {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .hook-game {
    font-size: var(--type-h2);
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .hook-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--type-small);
  }

  .hook-actions,
  .hook-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .hook-status,
  .hook-count {
    margin-right: auto;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hook-status-on {
    color: var(--accent-color);
    font-weight: 700;
  }

  .hook-bar {
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--font-color);
  }

  .hook-text {
    max-height: 70vh;
    overflow-y: auto;
    font-size: 1.25rem;
    line-height: 2;
  }

  .hook-text li {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-color);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
