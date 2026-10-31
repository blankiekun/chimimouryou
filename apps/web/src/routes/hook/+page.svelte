<script lang="ts">
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AnkiWatcher from '$lib/components/dictionary/anki-watcher.svelte';
  import LookupPopup from '$lib/components/dictionary/lookup-popup.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import {
    ankiSentenceField$,
    ankiVnAudio$,
    ankiVnScreenshot$,
    noteSentence,
    vnLineFor,
    type AnkiMedia,
    type AnkiNote
  } from '$lib/data/dictionary/anki';
  import { formatDuration, localNetworkDenied } from '$lib/data/discord/discord';
  import { pagePath } from '$lib/data/env';
  import { addImmersionTime } from '$lib/data/stats/immersion-log';
  import { logger } from '$lib/data/logger';
  import { readingActivity } from '$lib/data/reader/reader-hooks';
  import { statisticsEnabled$, trackerIdleTime$ } from '$lib/data/store';
  import {
    charsPerHour,
    clock,
    editLine,
    hookCleanup$,
    hookFlash$,
    hookFontSize$,
    hookNotes$,
    hookPresets,
    HookSocket,
    hookReverse$,
    hookSocketUrl$,
    hookSocketUrl2$,
    hookTitle$,
    lineCount,
    loadLines,
    maxLines,
    maxNotes,
    maxUndo,
    parseHookMessage,
    removeLines,
    saveLines,
    undoLines,
    type HookLine,
    type HookStatus,
    type HookUndo
  } from '$lib/data/vn/texthooker';
  import ReaderSheet from '$lib/components/book-reader/reader-sheet.svelte';
  import HookLines from '$lib/components/vn/hook-lines.svelte';
  import HookSettings from '$lib/components/vn/hook-settings.svelte';
  import NativeGameDialog from '$lib/components/vn/native-game-dialog.svelte';
  import NativeThreads from '$lib/components/vn/native-threads.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { page } from '$lib/data/page-store';
  import { database } from '$lib/data/store';
  import { hookCleaner, type HookCleanup } from '$lib/data/vn/hook-cleanup';
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
   * Select mode, undo, notes, presets, Pause and the stats strip follow texthooker-ui (MIT).
   */

  const statusLabels: Record<HookStatus, MessageKey> = {
    connecting: 'hook.status.connecting',
    connected: 'hook.status.connected',
    closed: 'hook.status.closed',
    blocked: 'hook.status.blocked',
    invalid: 'hook.status.invalid',
    off: 'hook.status.off'
  };
  let url = $state(hookSocketUrl$.getValue());
  let title = $state(hookTitle$.getValue());
  let status = $state<HookStatus>('off');
  let status2 = $state<HookStatus>('off');
  let lines = $state<HookLine[]>(loadLines());
  let sessionCharacters = $state(0);
  let sessionSeconds = $state(0);
  let list = $state<HTMLOListElement>();
  let lookupPopup = $state<LookupPopup>();
  /** Paused: lines still show, but add nothing to the log or the session */
  let paused = $state(false);
  /** Lines from before this (the page opened, Pause ended) add no time: nobody was reading. */
  let since = $state(Date.now());
  let now = $state(Date.now());
  let stats = $state<HTMLElement>();
  let strip = $state<HTMLElement>();
  /** Connected, the address form folds to one line; Change opens it again. */
  let changing = $state(false);
  let connectedUrl = $state('');
  const toolName = $derived(
    hookPresets.find((preset) => preset.url === connectedUrl)?.label ?? connectedUrl
  );
  let undo = $state<HookUndo[]>([]);
  let flashId = $state<string>();
  let showSettings = $state(false);
  let showNotes = $state(false);
  /** The last lines as sent, before cleanup: the cleanup's preview and suggestion */
  let raw = $state<string[]>([]);
  let lineSeq = 0;

  const socket = new HookSocket(
    (data) => fromSocket(data, 'ws1'),
    (next) => {
      status = next;
      if (next === 'connected') changing = false;
    },
    localNetworkDenied
  );
  const socket2 = new HookSocket(
    (data) => fromSocket(data, 'ws2'),
    (next) => (status2 = next),
    localNetworkDenied
  );
  let socketCleanup = $state<HookCleanup>(hookCleanup$.getValue());
  let socketClean = hookCleaner(hookCleanup$.getValue());
  const cleanupSubscription = hookCleanup$.subscribe((next) => {
    socketCleanup = next;
    socketClean = hookCleaner(next);
  });

  const lastLine = $derived(lines.at(-1));
  /** The running gap since the last line, capped like lineCount: shown, logged with the next line */
  const timer = $derived.by(() => {
    const idle = $trackerIdleTime$ > 0 ? $trackerIdleTime$ : 120;
    const gap =
      !paused && lastLine && lastLine.at >= since ? Math.min(idle, (now - lastLine.at) / 1000) : 0;

    return sessionSeconds + Math.max(0, gap);
  });

  const gameTitle = () => title.trim() || 'Texthooker';

  // Set on mount: the address can't be read while prerendering.
  let nativeId = $state<number>();
  const games = desktopGames();
  let nativeHook = $state<NativeHook>();
  let nativeStatus = $state('Starting the game…');
  let nativeRunning = $state(false);
  let ranked = $state<{ thread: NativeThread; score: number }[]>([]);
  let threads = new Threads();
  let cleanup = $state<HookCleanup>({});
  let clean = hookCleaner({});
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let stopListening: (() => void) | undefined;
  /** vnsaves.json, shared with VNBox: pulled before the game starts, pushed when it closes. */
  let saveSync: VnSaveSync | undefined;
  let saveStamp: string | undefined;
  let saveNote = $state<string>();
  /** Windows: folders the game's first run wrote, to confirm as its saves */
  let pendingFolders = $state<string[]>();
  /** Where Anki clips' sound comes from, said under the status */
  let audioNote = $state<string>();
  const audioNotes = {
    game: 'Anki clips record this game’s sound.',
    process: 'Anki clips record this game’s sound.',
    system: 'Anki clips record the whole computer’s sound: this game’s alone isn’t available here.',
    none: 'Anki clips have no sound: on Linux they need PulseAudio or PipeWire (pactl and parec).'
  };

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
    else if (message.type === 'audio') audioNote = audioNotes[message.mode];
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
        keepRaw(message.sentence);
        addLine(clean(message.sentence, thread.hookcode).trim(), message.seq);
      }
    }
  }

  /**
   * For a note added to Anki while playing natively: the screenshot and sound of the line its
   * sentence was mined from, kept by the app since the game started. Notes from elsewhere are left
   * alone.
   */
  async function ankiMedia(note: AnkiNote): Promise<AnkiMedia> {
    const index = vnLineFor(
      noteSentence(note),
      lines.map((line) => line.text)
    );
    const seq = lines[index]?.seq;

    if (seq === undefined || !games) {
      throw new Error(
        `card left alone, its ${$ankiSentenceField$.trim()} field isn't a line of this game's recent text`
      );
    }
    const found = await games.media(seq, { picture: $ankiVnScreenshot$, audio: $ankiVnAudio$ });

    return {
      picture: found.picture && new Blob([found.picture], { type: 'image/jpeg' }),
      audio: found.audio && new Blob([found.audio], { type: 'audio/wav' })
    };
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

  /** A natively played game's cleanup: applied at once, saved on its record half a second later. */
  function setNativeCleanup(next: HookCleanup) {
    cleanup = next;
    clean = hookCleaner(next);
    ranked = rankThreads([...threads.threads.values()], next) as typeof ranked;
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(async () => {
      const stored = await database.getData(nativeId!);

      if (!stored) return;
      await database.upsertData(
        { ...stored, elementHtml: vnElementHtml({ ...vnInfo(stored), hookCleanup: next }) },
        ReplicationSaveBehavior.Overwrite,
        false,
        false
      );
    }, 500);
  }

  function connect() {
    hookSocketUrl$.next(url);
    connectedUrl = url;
    socket.connect(url);
    if (hookSocketUrl2$.getValue()) socket2.connect(hookSocketUrl2$.getValue());
    else socket2.disconnect();
  }

  function disconnect() {
    socket.disconnect();
    socket2.disconnect();
  }

  function keepRaw(text: string) {
    raw = [...raw, text].slice(-20);
  }

  function fromSocket(data: unknown, thread: string) {
    const text = parseHookMessage(data);

    if (!text) return;
    keepRaw(text);
    addLine(socketClean(text, thread).trim());
  }

  /** The stats strip lights up: a line came in while paused and wasn't counted. */
  function flashPaused() {
    const tint = stats && getComputedStyle(stats).getPropertyValue('--app-spot-tint').trim();

    // The phone strip or the session box: whichever is shown.
    [stats, strip].forEach((element) =>
      element?.animate(
        [{ backgroundColor: tint || 'transparent' }, { backgroundColor: 'transparent' }],
        {
          duration: 700,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
        }
      )
    );
  }

  function togglePause() {
    paused = !paused;
    if (!paused) since = Date.now();
  }

  function addLine(text: string, seq?: number) {
    if (!text) return;

    const at = Date.now();
    const count = lineCount(text, lines.at(-1), at, $trackerIdleTime$, since);

    if (count.repeat) return;

    const reverse = $hookReverse$;
    const atEdge =
      !list ||
      (reverse ? list.scrollTop < 80 : list.scrollHeight - list.scrollTop - list.clientHeight < 80);
    const line = { id: `${at}-${lineSeq++}`, text, at, seq };

    lines = [...lines, line].slice(-maxLines);
    if (seq !== undefined) games?.mark(seq);
    saveLines(lines);
    flashId = $hookFlash$ ? line.id : undefined;
    if (atEdge) {
      tick().then(() => list && (list.scrollTop = reverse ? 0 : list.scrollHeight));
    }
    if (paused) {
      flashPaused();
      return;
    }

    sessionCharacters += count.characters;
    sessionSeconds += count.seconds;
    // Each line at once: a closed tab loses nothing.
    if ($statisticsEnabled$) {
      addImmersionTime('hook', 'vn', gameTitle(), count.seconds, count.characters).catch((error) =>
        logger.warn(`Couldn't save to the immersion log: ${error.message}`)
      );
    }
    readingActivity({ kind: 'vn', title: gameTitle(), position: sessionCharacters });
  }

  function pushUndo(entry: HookUndo) {
    undo = [...undo, entry].slice(-maxUndo);
  }

  // Edits, deletes and undo change only the list: what a line logged stays logged.
  function removeSelected(ids: Set<string>) {
    const result = removeLines(lines, ids);

    lines = result.lines;
    saveLines(lines);
    pushUndo(result.undo);
  }

  function editSelected(id: string, text: string) {
    const result = editLine(lines, id, text);

    if (!result) return;
    lines = result.lines;
    saveLines(lines);
    pushUndo(result.undo);
  }

  function undoLast() {
    const entry = undo.at(-1);

    if (!entry) return;
    undo = undo.slice(0, -1);
    lines = undoLines(lines, entry);
    saveLines(lines);
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
    undo = [];
    saveLines([]);
  }

  function saveTitle() {
    hookTitle$.next(title.trim());
  }

  onMount(() => {
    nativeId = (games && Number($page.url.searchParams.get('native'))) || undefined;
    if (nativeId) startNative().catch((error) => (nativeStatus = error.message));
    else connect();
    if (list) list.scrollTop = $hookReverse$ ? 0 : list.scrollHeight;

    const ticker = setInterval(() => (now = Date.now()), 1000);

    return () => clearInterval(ticker);
  });

  onDestroy(() => {
    stopListening?.();
    cleanupSubscription.unsubscribe();
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
      <div>
        <h1 class="hook-title">{$t$('hook.title')}</h1>
        <p class="hook-subtitle">{$t$('hook.subtitle')}</p>
      </div>
      <div class="hook-head-actions">
        <button type="button" class="app-button" onclick={() => (showNotes = true)}>Notes</button>
        <button type="button" class="app-button" onclick={() => (showSettings = true)}>
          Settings
        </button>
      </div>
    </header>

    <!-- Phones: the session in one row, so the lines start in the first screen. -->
    <div class="hook-strip" bind:this={strip}>
      <dl class="hook-figures">
        <div>
          <dt>Chars</dt>
          <dd>{sessionCharacters.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{clock(timer)}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{charsPerHour(sessionCharacters, sessionSeconds).toLocaleString('en-US')}/h</dd>
        </div>
      </dl>
      <button
        type="button"
        class="app-button"
        class:app-button-primary={paused}
        aria-pressed={paused}
        onclick={togglePause}
      >
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>
    {#if paused}
      <p class="hook-hint hook-phone-only" role="status">
        Paused: new lines show, but aren’t logged or timed.
      </p>
    {/if}

    <div class="hook-top">
      <div class="hook-session-box">
        <PointBox
          label={$t$('hook.session')}
          figure={sessionCharacters}
          unit={$t$('dashboard.unit')}
        >
          <div class="hook-stats" bind:this={stats}>
            <dl class="hook-figures">
              <div>
                <dt>Time</dt>
                <dd>{clock(timer)}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>{charsPerHour(sessionCharacters, sessionSeconds).toLocaleString('en-US')}/h</dd>
              </div>
              <div>
                <dt>Lines</dt>
                <dd>{lines.length.toLocaleString('en-US')}</dd>
              </div>
            </dl>
            <button
              type="button"
              class="app-button"
              class:app-button-primary={paused}
              aria-pressed={paused}
              onclick={togglePause}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          {#if paused}
            <p class="hook-hint">Paused: new lines show, but aren’t logged or timed.</p>
          {/if}
          <p class="hook-session">
            {formatDuration(sessionSeconds) || $t$('hook.underMinute')} ·
            <a href="{pagePath}/statistics">{$t$('hook.toLog')}</a>
          </p>
          {#if !$statisticsEnabled$}
            <p class="hook-hint">{$t$('hook.statisticsOff')}</p>
          {/if}
        </PointBox>
      </div>

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
          {#if audioNote}
            <p class="hook-hint">{audioNote}</p>
          {/if}
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
        <AnkiWatcher media={ankiMedia} />
      {:else if status === 'connected' && !changing}
        <div class="hook-actions hook-connected">
          <span class="hook-status-line">
            <span class="hook-status hook-status-on" role="status">
              {$t$(statusLabels[status])}
            </span>
            <span class="hook-tool">{toolName}</span>
          </span>
          <button
            type="button"
            class="app-button app-button-quiet"
            onclick={() => (changing = true)}
          >
            Change
          </button>
          <button type="button" class="app-button app-button-quiet" onclick={disconnect}>
            {$t$('hook.disconnect')}
          </button>
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
            {#if changing}
              <button
                type="button"
                class="app-button app-button-quiet"
                onclick={() => {
                  changing = false;
                  url = connectedUrl;
                }}
              >
                Cancel
              </button>
            {:else if status !== 'off' && status !== 'invalid'}
              <!-- Retrying: stops it -->
              <button type="button" class="app-button app-button-quiet" onclick={disconnect}>
                {$t$('hook.disconnect')}
              </button>
            {/if}
            {#if changing || status === 'off' || status === 'invalid' || url !== connectedUrl}
              <button type="submit" class="app-button">{$t$('hook.connect')}</button>
            {/if}
          </div>
        </form>
      {/if}
    </div>

    <HookLines
      {lines}
      fontSize={$hookFontSize$}
      reverse={$hookReverse$}
      {flashId}
      canUndo={undo.length > 0}
      empty={$t$('hook.empty')}
      bind:list
      ontap={(event) => lookupPopup?.tapAt(event.clientX, event.clientY)}
      onremove={removeSelected}
      onedit={editSelected}
      onundo={undoLast}
    >
      {#snippet tools()}
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
      {/snippet}
    </HookLines>
  </main>
</div>

<LookupPopup bind:this={lookupPopup} scope=".hook-text" />

{#if showSettings}
  <ReaderSheet title="Settings" on:close={() => (showSettings = false)}>
    <HookSettings
      native={!!nativeId}
      cleanup={nativeId ? cleanup : socketCleanup}
      {raw}
      {status2}
      oncleanup={(next) => (nativeId ? setNativeCleanup(next) : hookCleanup$.next(next))}
      onreconnect={() => {
        url = hookSocketUrl$.getValue();
        if (status !== 'off') connect();
      }}
    />
  </ReaderSheet>
{/if}

{#if showNotes}
  <ReaderSheet title="Notes" on:close={() => (showNotes = false)}>
    <textarea
      class="app-input hook-notes"
      aria-label="Notes"
      maxlength={maxNotes}
      value={$hookNotes$}
      oninput={(event) => hookNotes$.next(event.currentTarget.value)}></textarea>
    <p class="hook-hint">Kept in this browser.</p>
  </ReaderSheet>
{/if}

<style>
  .hook {
    display: flex;
    max-width: 60rem;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }

  .hook-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
  }

  .hook-head-actions {
    display: flex;
    gap: 0.5rem;
  }

  .hook-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .hook-subtitle,
  .hook-hint {
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

  .hook-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .hook-status {
    margin-right: auto;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hook-status-on {
    color: var(--accent-color);
    font-weight: 700;
  }

  .hook-strip {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 -0.5rem;
    padding: 0.5rem;
    border-top: 2px solid var(--accent-color);
    border-bottom: 1px solid var(--border-color);
  }

  .hook-strip .hook-figures {
    gap: 1rem;
  }

  .hook-strip dd {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .hook-status-line {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.5rem;
    margin-right: auto;
  }

  .hook-status-line .hook-status {
    margin-right: 0;
  }

  .hook-tool {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  @media (min-width: 640px) {
    .hook-strip,
    .hook-phone-only {
      display: none;
    }
  }

  @media (max-width: 639px) {
    .hook-session-box,
    .hook-subtitle {
      display: none;
    }

    .hook {
      gap: 1rem;
      padding-top: 1rem;
    }

    .hook-title {
      font-size: var(--type-h1);
    }

    .hook-top {
      gap: 1rem;
    }
  }

  .hook-stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin: 0.75rem -0.5rem 0;
    padding: 0.5rem;
    border-top: 1px solid var(--border-color);
  }

  .hook-figures {
    display: flex;
    flex: 1;
    gap: 1.25rem;
    margin: 0;
  }

  .hook-figures dt {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .hook-figures dd {
    margin: 0;
    font-size: var(--type-h2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .hook-notes {
    display: block;
    width: 100%;
    height: 50vh;
    margin: 1rem 0 0.5rem;
    line-height: 1.6;
    resize: vertical;
  }
</style>
