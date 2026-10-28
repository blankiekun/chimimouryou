<script lang="ts">
  /**
   * The /v player's Hooks sheet for Windows games: the text threads VNBox's hooks send, which
   * one drives the overlay, statistics and Anki, a hook search, H-codes and scripts loaded while
   * the game runs, and saving the pick as the game's hook (vnbox.js `vnboxHooks`, VNBox's hooks
   * contract). VNBox without runtime hooks only shows the saved hook. Not upstream.
   */
  import SectionHead from '$lib/components/section-head.svelte';
  import { database } from '$lib/data/store';
  import { vnElementHtml, vnInfo } from '$lib/data/vn';
  import { rankThreads, savedHookName, type HookThread } from '$lib/data/windows-game';
  import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

  interface Props {
    /** The player frame, whose vnbox.js keeps the threads */
    frame?: HTMLIFrameElement;
    bookId: number;
  }

  let { frame, bookId }: Props = $props();

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

  $effect(() => {
    database.getData(bookId).then((stored) => (saved = stored && savedHookName(vnInfo(stored))));
  });

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

  const ranked = $derived(rankThreads(threads));
  const suggested = $derived(ranked[0]?.score >= 0.5 ? ranked[0].thread.id : undefined);
  const picked = $derived(threads.find((thread) => thread.id === selected));
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
    <p class="hooks-muted">
      {searching
        ? 'Click through a few lines in the game, then pick the thread with the text and stop.'
        : 'Hooks the text functions Windows games draw with and lists what each sends.'}
    </p>
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
              <span class="hooks-thread-line" lang="ja">{thread.last ?? ''}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <SectionHead number={3} title="H-code" level="h3" />
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

    <SectionHead number={4} title="Hook script" level="h3" />
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
