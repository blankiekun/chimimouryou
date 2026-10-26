<script lang="ts">
  /**
   * Import → Windows game: a game folder is copied into this browser (windows-game.ts) and
   * added to the library as a visual novel that VNBox plays. Pick the folder, the program to
   * run and, optionally, a dc00 text hook script; then the copy runs with its progress here.
   */
  import SectionHead from '$lib/components/section-head.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { formatBytes } from '$lib/data/vn-upload';
  import {
    copyWindowsGame,
    hookScripts,
    hookSuggestion,
    searchHookScripts,
    windowsGameBlocker,
    windowsGameBlockerText,
    windowsGameBook,
    windowsGameFolder,
    windowsPrograms
  } from '$lib/data/windows-game';
  import type { HookScript } from '$lib/data/windows-game';
  import type { LoadData } from '$lib/functions/file-loaders/types';

  interface Props {
    /** Adds the game's book record to the library (the manage page's storage source) */
    save: (book: LoadData) => Promise<void>;
  }

  let { save }: Props = $props();

  const blocker = windowsGameBlocker();
  /** Programs listed before "More": most folders have one game and a few tools */
  const shownPrograms = 6;

  let files = $state<Record<string, File>>({});
  let folderName = $state('');
  let title = $state('');
  let exe = $state('');
  let hook = $state<{ name: string; text: string }>();
  let scripts = $state<HookScript[]>([]);
  let query = $state('');
  /** The reader's pick once they touch the list ('' none, CHOSEN their file, else a bundled file) */
  let picked = $state<string>();
  let copied = $state<{ done: number; total: number }>();
  let error = $state('');
  let showAll = $state(false);
  let abort: AbortController | undefined;
  let folderInput: HTMLInputElement | undefined = $state();

  const programs = $derived(windowsPrograms(files));
  const size = $derived(Object.values(files).reduce((sum, file) => sum + file.size, 0));
  const count = $derived(Object.keys(files).length);
  const busy = $derived(!!copied);
  const suggested = $derived(hookSuggestion(scripts, { exe, names: [title, folderName] }));
  const choice = $derived(picked ?? suggested ?? '');
  /** The suggestion, the current pick and the search results, each once */
  const listed = $derived(
    scripts.filter(
      (script) =>
        script.file === suggested ||
        script.file === choice ||
        (query.trim() && searchHookScripts([script], query).length)
    )
  );
  const CHOSEN = '#chosen';

  hookScripts().then((found) => (scripts = found));

  function useFolder(name: string, picked: Record<string, File>) {
    files = picked;
    folderName = name;
    title = name;
    exe = windowsPrograms(picked)[0] ?? '';
    error = exe
      ? ''
      : 'This folder has no Windows program (.exe). Choose the folder the game runs from.';
  }

  const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'));

  async function readHandle(dir: FileSystemDirectoryHandle, prefix = '') {
    const found: Record<string, File> = {};

    for await (const [name, handle] of (dir as any).entries()) {
      const path = `${prefix}${name}`;

      if (hidden(path)) continue;
      if (handle.kind === 'directory') Object.assign(found, await readHandle(handle, `${path}/`));
      else found[path] = await handle.getFile();
    }

    return found;
  }

  async function chooseFolder() {
    const picker = (window as any).showDirectoryPicker;

    // Chrome and Edge: the folder's handle. Elsewhere: the folder as files (webkitdirectory).
    if (!picker) {
      folderInput?.click();
      return;
    }

    try {
      const dir: FileSystemDirectoryHandle = await picker({ id: 'windows-game', mode: 'read' });

      useFolder(dir.name, await readHandle(dir));
    } catch (pickError: any) {
      if (pickError?.name !== 'AbortError')
        error = `Could not read the folder: ${pickError.message}`;
    }
  }

  function folderPicked(list: FileList | null) {
    const picked: Record<string, File> = {};

    for (const file of Array.from(list ?? [])) {
      // webkitRelativePath starts with the picked folder's own name.
      const path = file.webkitRelativePath.split('/').slice(1).join('/');

      if (path && !hidden(path)) picked[path] = file;
    }

    const first = list?.[0]?.webkitRelativePath.split('/')[0];

    if (first) useFolder(first, picked);
  }

  async function hookPicked(list: FileList | null) {
    const file = list?.[0];

    if (!file) return;

    hook = { name: file.name, text: await file.text() };
    picked = CHOSEN;
  }

  function close() {
    abort?.abort();
    dialogManager.dialogs$.next([]);
  }

  async function add() {
    const name = title.trim();

    if (!name || !exe) return;

    error = '';
    abort = new AbortController();

    try {
      const { quota = 0, usage = 0 } = (await navigator.storage.estimate?.()) ?? {};

      if (quota && quota - usage < size) {
        throw new Error(
          `Not enough room in this browser's storage: the game is ${formatBytes(size)}, ${formatBytes(quota - usage)} is free.`
        );
      }

      // Big games must not be evicted when the disk fills up.
      await navigator.storage.persist?.();
      copied = { done: 0, total: size };
      await copyWindowsGame(
        windowsGameFolder(name),
        files,
        (done, total) => (copied = { done, total }),
        abort.signal
      );
      await save(
        windowsGameBook(
          name,
          exe,
          choice === CHOSEN ? hook?.text : undefined,
          undefined,
          choice === CHOSEN ? undefined : choice || undefined
        )
      );
      dialogManager.dialogs$.next([]);
    } catch (addError: any) {
      if (addError?.name !== 'AbortError') error = addError.message;
      copied = undefined;
    }
  }
</script>

<section class="wg" aria-labelledby="wg-title">
  <h2 id="wg-title" class="wg-title">Add a Windows game</h2>
  <p class="wg-lead">
    The game folder is copied into this browser and runs here, offline. Nothing is uploaded.
  </p>

  {#if blocker}
    <p class="wg-note" role="status">{windowsGameBlockerText[blocker]}</p>
    <footer class="wg-actions">
      <button type="button" class="app-button" onclick={close}>Close</button>
    </footer>
  {:else}
    <div class="wg-step">
      <SectionHead number={1} title="Game folder" level="h3" />
      <div class="wg-row">
        <button type="button" class="app-button" disabled={busy} onclick={chooseFolder}>
          {folderName ? 'Change folder' : 'Choose folder'}
        </button>
        {#if folderName}
          <span class="wg-meta" lang="ja">
            {folderName}<span class="wg-dim"> · {formatBytes(size)} · {count} files</span>
          </span>
        {/if}
      </div>
      <input
        hidden
        type="file"
        webkitdirectory
        bind:this={folderInput}
        onchange={(event) => folderPicked(event.currentTarget.files)}
      />
      {#if folderName}
        <label class="wg-field">
          <span class="wg-label">Title</span>
          <input class="app-input" lang="ja" bind:value={title} disabled={busy} />
        </label>
      {/if}
    </div>

    {#if programs.length}
      <div class="wg-step">
        <SectionHead number={2} title="Program" level="h3" count={programs.length} />
        <ul class="wg-programs">
          {#each showAll ? programs : programs.slice(0, shownPrograms) as program (program)}
            <li>
              <label class="wg-program">
                <input
                  type="radio"
                  name="wg-exe"
                  value={program}
                  bind:group={exe}
                  disabled={busy}
                />
                <span lang="ja">{program}</span>
                <span class="wg-dim">{formatBytes(files[program].size)}</span>
              </label>
            </li>
          {/each}
        </ul>
        {#if !showAll && programs.length > shownPrograms}
          <button type="button" class="app-button-quiet wg-more" onclick={() => (showAll = true)}>
            Show all {programs.length}
          </button>
        {/if}
      </div>

      <div class="wg-step">
        <SectionHead number={3} title="Text hook" level="h3" count="Optional" />
        <p class="wg-note">
          A dc00 script for this game sends its text to the reader: lookups over the game,
          statistics and Anki cards. Without one the game plays, but no text arrives.
          <a
            class="app-button-quiet wg-link"
            href="https://github.com/0xDC00/scripts"
            target="_blank"
            rel="noreferrer">Find a script</a
          >
        </p>
        {#if scripts.length}
          <input
            class="app-input"
            type="search"
            placeholder="Search {scripts.length} scripts"
            aria-label="Search hook scripts"
            bind:value={query}
            disabled={busy}
          />
        {/if}
        <ul class="wg-programs">
          <li>
            <label class="wg-program">
              <input
                type="radio"
                name="wg-hook"
                checked={choice === ''}
                disabled={busy}
                onchange={() => (picked = '')}
              />
              <span>No script</span>
            </label>
          </li>
          {#each listed as script (script.file)}
            <li>
              <label class="wg-program">
                <input
                  type="radio"
                  name="wg-hook"
                  checked={choice === script.file}
                  disabled={busy}
                  onchange={() => (picked = script.file)}
                />
                <span lang="ja">{script.name}</span>
                {#if script.file === suggested}<span class="wg-dim">Suggested</span>{/if}
              </label>
            </li>
          {/each}
          {#if hook}
            <li>
              <label class="wg-program">
                <input
                  type="radio"
                  name="wg-hook"
                  checked={choice === CHOSEN}
                  disabled={busy}
                  onchange={() => (picked = CHOSEN)}
                />
                <span>{hook.name}</span>
                <span class="wg-dim">Your file</span>
              </label>
            </li>
          {/if}
        </ul>
        <div class="wg-row">
          <label class="app-button" class:wg-disabled={busy}>
            <input
              hidden
              type="file"
              accept=".js,text/javascript"
              disabled={busy}
              onchange={(event) => hookPicked(event.currentTarget.files)}
            />
            {hook ? 'Choose another file' : 'Choose file…'}
          </label>
          <span class="wg-dim"
            >A chosen file must be self-contained: require() only works for listed scripts.</span
          >
        </div>
      </div>
    {/if}

    {#if error}
      <p class="wg-error" role="alert">{error}</p>
    {/if}

    {#if copied}
      <div class="wg-progress" role="status">
        <span class="wg-track">
          <span
            class="wg-fill"
            style:width="{copied.total ? (100 * copied.done) / copied.total : 0}%"
          ></span>
        </span>
        <span class="wg-dim">
          Copying {formatBytes(copied.done)} of {formatBytes(copied.total)}
        </span>
      </div>
    {/if}

    <footer class="wg-actions">
      <button type="button" class="app-button" onclick={close}>Cancel</button>
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={busy || !exe || !title.trim()}
        onclick={add}
      >
        Add game
      </button>
    </footer>
  {/if}
</section>

<style>
  .wg {
    display: flex;
    width: min(36rem, 80vw);
    max-height: 85vh;
    flex-direction: column;
    gap: 1.5rem;
    overflow-y: auto;
    padding: 1.5rem;
    border-top: 2px solid var(--font-color);
    border-radius: 2px;
    background: var(--surface-strong-color);
    color: var(--font-color);
    font-size: var(--type-body);
  }

  .wg-title {
    font-size: var(--type-h2);
    font-weight: 700;
    line-height: 1.3;
  }

  .wg-lead {
    margin-top: -1rem;
    color: var(--app-muted-fg);
  }

  .wg-step {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .wg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .wg-meta {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .wg-dim {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .wg-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .wg-label {
    font-size: var(--type-label);
    font-weight: 700;
  }

  .wg-programs {
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--font-color);
    list-style: none;
  }

  .wg-programs li {
    border-bottom: 1px solid var(--border-color);
  }

  .wg-program {
    display: flex;
    min-height: var(--app-control-height, 2.5rem);
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .wg-program input {
    flex: none;
    accent-color: var(--accent-color);
  }

  .wg-program span:first-of-type {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .wg-more {
    align-self: flex-start;
  }

  .wg-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.7;
  }

  .wg-link {
    display: inline;
    height: auto;
    padding: 0;
  }

  .wg-disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .wg-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .wg-progress {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .wg-track {
    position: relative;
    height: 3px;
    background: var(--app-progress-track);
  }

  .wg-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-color);
  }

  .wg-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
