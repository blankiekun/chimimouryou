<script lang="ts">
  /**
   * The /v player's Hooks sheet for Windows games: the text threads VNBox's hooks send, which
   * one drives the overlay, statistics and Anki, a hook search, H-codes and scripts loaded while
   * the game runs, and saving the pick as the game's hook (vnbox.js `vnboxHooks`, VNBox's hooks
   * contract), and the game's text cleanup (hook-cleanup.ts), saved with the hook. VNBox
   * without runtime hooks only shows the saved hook and the cleanup. "Text from" reads a game whose
   * hook gives nothing from its screen (VnInfo.textFrom, lib/data/vn/vn-ocr.ts). Not upstream.
   */
  import SectionHead from '$lib/components/section-head.svelte';
  import Switch from '$lib/components/switch.svelte';
  import HookCleanupEditor from '$lib/components/vn/hook-cleanup-editor.svelte';
  import { cleanHookLine, type HookCleanup } from '$lib/data/vn/hook-cleanup';
  import { screenTextOff$, stopVnOcr } from '$lib/data/vn/vn-ocr';
  import { database } from '$lib/data/store';
  import { vnElementHtml, vnInfo } from '$lib/data/vn/vn';
  import {
    approveHook,
    rankThreads,
    savedHookName,
    type HookThread
  } from '$lib/data/vn/windows-game';
  import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

  interface Props {
    /** The player frame, whose vnbox.js keeps the threads */
    frame?: HTMLIFrameElement;
    bookId: number;
    /** The game's text cleanup, which the page applies to hooked lines */
    cleanup: HookCleanup;
    oncleanup: (cleanup: HookCleanup) => void;
  }

  let { frame, bookId, cleanup, oncleanup }: Props = $props();

  interface VnboxHooks {
    live(): boolean;
    threads(): HookThread[];
    selected(): string | null;
    select(id: string | null): void;
    listen(listener: () => void): () => void;
    load(source: string): string;
    loadHcode(code: string): string;
    searching(): boolean;
    searchStart(): void;
    searchStop(): void;
    scriptFor(id: string): string;
    reset(): void;
    setScreenText(on: boolean): void;
    setPlaceText(on: boolean): void;
  }

  const hooks = $derived((frame?.contentWindow as any)?.vnboxHooks as VnboxHooks | undefined);

  let threads: HookThread[] = $state([]);
  let selected: string | null = $state(null);
  let searching = $state(false);
  let live = $state(false);
  /** The saved hook's name, read from the book: a save here doesn't reload the game. */
  let saved: string | undefined = $state();
  let hcode = $state('');
  let script = $state('');
  let hcodeError = $state('');
  let scriptError = $state('');
  let saveState = $state('');
  let screenText = $state(false);
  let placeText = $state(true);

  $effect(() => {
    database.getData(bookId).then((stored) => {
      saved = stored && savedHookName(vnInfo(stored));
      screenText = !!stored && vnInfo(stored).textFrom === 'screen';
      placeText = !stored || vnInfo(stored).placeText !== false;
    });
  });

  /** Saved on the book: absent = Hook, and placed over the game's line. */
  async function saveText(screen: boolean, place: boolean) {
    const stored = await database.getData(bookId);

    if (!stored) return;
    const { textFrom: _from, placeText: _place, ...game } = vnInfo(stored);

    await database.upsertData(
      {
        ...stored,
        elementHtml: vnElementHtml({
          ...game,
          ...(screen && { textFrom: 'screen' as const }),
          ...(!place && { placeText: false })
        })
      },
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );
  }

  /** Applied to the running game at once. */
  function setTextFrom(screen: boolean) {
    screenText = screen;
    hooks?.setScreenText(screen);
    saveText(screen, placeText);
  }

  /** Applied to the running game at once. */
  function setPlaceText(place: boolean) {
    placeText = place;
    hooks?.setPlaceText(place);
    saveText(screenText, place);
  }

  $effect(() => {
    if (!hooks) return undefined;

    const read = () => {
      threads = hooks.threads();
      selected = hooks.selected();
      live = hooks.live();
      searching = live && hooks.searching();
    };

    read();
    return hooks.listen(read);
  });

  const ranked = $derived(rankThreads(threads, cleanup));
  const suggested = $derived(ranked[0]?.score >= 0.5 ? ranked[0].thread.id : undefined);
  const picked = $derived(threads.find((thread) => thread.id === selected));
  /** The thread the cleanup is previewed and suggested on: the picked one, else the best. */
  const shown = $derived(picked ?? ranked[0]?.thread);
  const nameOf = (thread: HookThread) =>
    thread.label || (thread.kind === 'script' ? 'Hook script' : thread.id);

  function load(kind: 'hcode' | 'script') {
    const source = kind === 'hcode' ? hcode.trim() : script;

    try {
      if (kind === 'hcode') {
        hooks!.loadHcode(source);
        hcodeError = '';
      } else {
        hooks!.load(source);
        scriptError = '';
      }
    } catch (error: any) {
      if (kind === 'hcode') hcodeError = error.message;
      else scriptError = error.message;
    }
  }

  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

  /** Applied at once; written to the book half a second after the last change. */
  function setCleanup(next: HookCleanup) {
    oncleanup(next);
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(async () => {
      const stored = await database.getData(bookId);

      if (!stored) return;
      await database.upsertData(
        { ...stored, elementHtml: vnElementHtml({ ...vnInfo(stored), hookCleanup: next }) },
        ReplicationSaveBehavior.Overwrite,
        false,
        false
      );
    }, 500);
  }

  async function save() {
    saveState = 'Saving…';
    try {
      const text = hooks!.scriptFor(selected!);
      const stored = (await database.getData(bookId))!;
      // A bundled script gives way to the saved one.
      const { hookFile: _bundled, ...game } = vnInfo(stored);

      await database.upsertData(
        { ...stored, elementHtml: vnElementHtml({ ...game, hook: text }) },
        ReplicationSaveBehavior.Overwrite,
        false,
        false
      );
      await approveHook(text);
      saved = savedHookName({ hook: text });
      saveState = 'Saved. The game starts with this hook next time.';
    } catch (error: any) {
      saveState = `Not saved: ${error.message}`;
    }
  }
</script>

<div class="hooks">
  <SectionHead number={1} title="Current hook" level="h3" />
  <p class="hooks-current">
    {#if picked}
      <strong>{nameOf(picked)}</strong>
      <span class="hooks-muted">Picked now · saved: {saved ?? 'none'}</span>
    {:else}
      <strong>{saved ?? 'None'}</strong>
      <span class="hooks-muted">{saved ? 'Saved for this game' : 'No hook script saved'}</span>
    {/if}
  </p>
  <div class="hooks-row hooks-from">
    <span id="hooks-from-label">Text from</span>
    <!-- .app-segmented and .app-segment are in app.scss. -->
    <div class="app-segmented" role="radiogroup" aria-labelledby="hooks-from-label">
      {#each [false, true] as screen (screen)}
        <button
          type="button"
          role="radio"
          aria-checked={screenText === screen}
          class="app-segment"
          class:app-segment-selected={screenText === screen}
          onclick={() => setTextFrom(screen)}
        >
          {screen ? 'Screen' : 'Hook'}
        </button>
      {/each}
    </div>
  </div>
  {#if screenText}
    <p class="hooks-muted" role="status">
      {$screenTextOff$
        ? `Screen text stopped (${$screenTextOff$}).`
        : 'Lines are read from the game’s screen after each click, for games whose hook gives nothing.'}
    </p>
    {#if $screenTextOff$}
      <button class="app-button app-button-quiet" onclick={stopVnOcr}>Try again</button>
    {/if}
  {:else}
    <Switch checked={placeText} onchange={setPlaceText}>Place text over the game’s line</Switch>
    <p class="hooks-muted">
      {placeText
        ? 'Each hooked line is matched to the screen and laid where the game draws it.'
        : 'Hooked lines sit in a fixed spot near the bottom of the game.'}
    </p>
  {/if}

  {#if !live}
    <p class="hooks-muted">
      {hooks
        ? 'Picking, searching and loading hooks while the game runs need a newer VNBox.'
        : 'The game has not started yet.'}
    </p>
  {:else}
    <div class="hooks-actions">
      <button class="app-button app-button-primary" disabled={!picked} onclick={save}>
        Save for this game
      </button>
      <button class="app-button" onclick={() => hooks!.reset()}>Back to the saved hook</button>
    </div>
    {#if saveState}
      <p class="hooks-muted hooks-status" role="status">{saveState}</p>
    {/if}

    <SectionHead number={2} title="Text threads" count={threads.length} level="h3" />
    <div class="hooks-actions">
      <button
        class="app-button"
        aria-pressed={searching}
        onclick={() => (searching ? hooks!.searchStop() : hooks!.searchStart())}
      >
        {searching ? 'Stop searching' : 'Search for text'}
      </button>
    </div>
    {#if searching}
      <p class="hooks-muted">Click through a few lines, then pick the thread with the text.</p>
    {/if}
    {#if threads.length}
      <ul class="hooks-threads" aria-label="Text threads">
        {#each ranked as { thread } (thread.id)}
          <li>
            <button
              class="hooks-thread"
              class:hooks-thread-picked={thread.id === selected}
              aria-pressed={thread.id === selected}
              onclick={() => hooks!.select(thread.id === selected ? null : thread.id)}
            >
              <span class="hooks-thread-head">
                <span class="hooks-thread-name">{nameOf(thread)}</span>
                {#if thread.id === suggested}
                  <span class="hooks-tag">Suggested</span>
                {/if}
                <span class="hooks-thread-count">{thread.count.toLocaleString('en')} lines</span>
              </span>
              <span class="hooks-thread-line" lang="ja">
                {cleanHookLine(thread.last ?? '', cleanup) || thread.last || ''}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <SectionHead number={live ? 3 : 2} title="Text cleanup" level="h3" />
  <HookCleanupEditor
    {cleanup}
    last={shown?.last}
    recent={shown?.recent.map((line) => line.text) ?? []}
    onchange={setCleanup}
  />

  {#if live}
    <SectionHead number={4} title="H-code" level="h3" />
    <form class="hooks-row" onsubmit={(event) => (event.preventDefault(), load('hcode'))}>
      <input
        class="app-input hooks-field"
        aria-label="H-code"
        placeholder="e.g. HS-14*8@4A1C32:Game.exe"
        spellcheck="false"
        autocomplete="off"
        bind:value={hcode}
      />
      <button class="app-button" disabled={!hcode.trim()}>Load</button>
    </form>
    {#if hcodeError}
      <p class="hooks-error" role="alert">{hcodeError}</p>
    {/if}

    <SectionHead number={5} title="Hook script" level="h3" />
    <textarea
      class="app-input hooks-script"
      aria-label="Hook script"
      placeholder="A dc00-style script, without require()"
      spellcheck="false"
      rows="6"
      bind:value={script}></textarea>
    <div class="hooks-actions">
      <button class="app-button" disabled={!script.trim()} onclick={() => load('script')}>
        Load
      </button>
    </div>
    {#if scriptError}
      <p class="hooks-error" role="alert">{scriptError}</p>
    {/if}
  {/if}
</div>

<style>
  .hooks {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
  }

  .hooks :global(.section-head) {
    margin-top: 0.75rem;
  }

  .hooks-current {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
  }

  .hooks-current strong {
    font-size: var(--type-h2);
    overflow-wrap: anywhere;
  }

  .hooks-muted {
    margin: 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hooks-actions,
  .hooks-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .hooks-from {
    align-items: center;
    gap: 0.75rem;
  }

  .hooks-field {
    min-width: 0;
    flex: 1;
    font-family: ui-monospace, monospace;
  }

  .hooks-script {
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: var(--type-small);
    resize: vertical;
  }

  .hooks-error {
    margin: 0;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .hooks-threads {
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--font-color);
    list-style: none;
  }

  .hooks-threads li {
    border-bottom: 1px solid var(--border-color);
  }

  .hooks-thread {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.6rem 0.5rem;
    text-align: left;
  }

  .hooks-thread:hover {
    background: var(--surface-color);
  }

  .hooks-thread-picked,
  .hooks-thread-picked:hover {
    background: var(--app-spot-tint);
  }

  .hooks-thread-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--type-small);
  }

  .hooks-thread-name {
    min-width: 0;
    overflow: hidden;
    color: var(--app-muted-fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hooks-thread-picked .hooks-thread-name {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .hooks-tag {
    flex: none;
    padding: 0 0.35rem;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .hooks-thread-count {
    flex: none;
    margin-left: auto;
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .hooks-thread-line {
    overflow: hidden;
    font-size: var(--type-body);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
