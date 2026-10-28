<script lang="ts">
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import LookupPopup from '$lib/components/dictionary/lookup-popup.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import { formatDuration, localNetworkDenied } from '$lib/data/discord';
  import { pagePath } from '$lib/data/env';
  import { addImmersionTime } from '$lib/data/immersion-log';
  import { logger } from '$lib/data/logger';
  import { readingActivity } from '$lib/data/reader-hooks';
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
  } from '$lib/data/texthooker';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { t$, type MessageKey } from '$lib/i18n';
  import { onDestroy, onMount, tick } from 'svelte';

  /**
   * The texthooker: game text from Textractor, LunaTranslator or agent over a WebSocket on this
   * computer, or pasted, as a list for Yomitan and the built-in lookups. Characters and time go
   * to the immersion log; the lines stay in this browser.
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
    connect();
    if (list) list.scrollTop = list.scrollHeight;
  });

  onDestroy(() => {
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
        <p class="hook-hint">
          {$t$('hook.addressHint', {
            presets: hookPresets.map((preset) => `${preset.label} ${preset.url}`).join(', ')
          })}
        </p>
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
