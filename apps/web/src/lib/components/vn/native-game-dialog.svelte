<script lang="ts">
  /**
   * Desktop app only: where a Windows game is installed on this computer, for playing it natively
   * (native-games.ts). The folder is picked in the app's own dialog (main process); this dialog
   * shows its programs, the record's program first, and links the chosen one to the game's
   * record. Without a record ("Add installed game") it also names the game and saves a record
   * with no browser files, as Import → Windows game would.
   */
  import SectionHead from '$lib/components/section-head.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { desktopGames, type PickResult } from '$lib/data/vn/native-games';
  import { windowsGameBook, windowsGameFolder } from '$lib/data/vn/windows-game';
  import type { LoadData } from '$lib/functions/file-loaders/types';

  interface Props {
    /** The game's record: its title, folder and program (link mode) */
    title?: string;
    folder?: string;
    exe?: string;
    /** The saved install folder that isn't there any more */
    gone?: string;
    /** Add mode: saves the new record (the library's saveWindowsGame) */
    save?: (book: LoadData) => Promise<void>;
    /** Called once linked (and saved) */
    done?: () => void;
  }

  let { title = '', folder, exe = '', gone, save, done }: Props = $props();

  const adding = $derived(!folder);
  let picked = $state<Extract<PickResult, { status: 'picked' }>>();
  let program = $state(-1);
  let name = $state('');
  let busy = $state(false);
  let error = $state('');

  const heading = $derived(
    adding
      ? 'Add an installed game'
      : gone
        ? `${title} isn’t at ${gone} any more`
        : `Where is ${title} installed on this computer?`
  );

  async function choose() {
    error = '';
    const result = await desktopGames()!.pick({ title: adding ? name : title, exe, gone });

    if (result.status !== 'picked') return;
    picked = result;
    program = result.match >= 0 ? result.match : result.programs.length === 1 ? 0 : -1;
    if (adding && !name.trim()) name = result.folderName;
  }

  async function link() {
    busy = true;
    error = '';
    try {
      const gameTitle = adding ? name.trim() : title;
      const key = folder ?? windowsGameFolder(gameTitle);
      const result = await desktopGames()!.link(picked!.id, program, key, gameTitle);

      if (result.status !== 'ok') throw new Error(result.message);
      if (adding) await save?.(windowsGameBook(gameTitle, result.exe, undefined, undefined));
      dialogManager.dialogs$.next([]);
      done?.();
    } catch (linkError: any) {
      error = linkError.message;
    } finally {
      busy = false;
    }
  }

  const wantedName = $derived(exe.split(/[\\/]/).pop());
</script>

<svelte:window
  onkeydown={(event) => event.key === 'Escape' && !busy && dialogManager.dialogs$.next([])}
/>

<section class="ng" aria-labelledby="ng-title">
  <h2 id="ng-title" class="ng-title" lang="ja">{heading}</h2>
  <p class="ng-lead">
    {#if adding}
      A game already installed on this computer, played natively with its text on the Texthooker
      page. Other devices list it and ask for their own copy.
    {:else}
      Pick the game’s folder. The path stays on this computer; other devices ask for their own.
    {/if}
  </p>

  {#if adding}
    <label class="ng-field">
      <span class="ng-label">Title</span>
      <input class="app-input" bind:value={name} lang="ja" disabled={busy} />
    </label>
  {/if}

  <div class="ng-step">
    <SectionHead number={1} title="Game folder" level="h3" />
    <div class="ng-row">
      <button type="button" class="app-button" onclick={choose} disabled={busy}>
        {picked ? 'Choose another folder…' : 'Choose folder…'}
      </button>
      {#if picked}
        <span class="ng-path">{picked.dir}</span>
      {/if}
    </div>
  </div>

  {#if picked}
    <div class="ng-step">
      <SectionHead number={2} title="Program" level="h3" count={picked.programs.length} />
      {#if !adding && wantedName && picked.match < 0}
        <p class="ng-warn" role="alert">
          This folder has no {wantedName}; it may be another game or version.
        </p>
      {/if}
      {#if !adding && picked.nameDiffers}
        <p class="ng-warn" role="alert">Folder name doesn’t match {title}.</p>
      {/if}
      {#if picked.programs.length}
        <ul class="ng-programs">
          {#each picked.programs as path, index (path)}
            <li>
              <label class="ng-program">
                <input type="radio" name="ng-exe" value={index} bind:group={program} />
                <span lang="ja">{path}</span>
                {#if index === picked.match}<span class="ng-dim">This game’s program</span>{/if}
              </label>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="ng-warn" role="alert">No programs (.exe) in this folder or the ones in it.</p>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="ng-warn" role="alert">{error}</p>
  {/if}

  <footer class="ng-actions">
    <button type="button" class="app-button" onclick={() => dialogManager.dialogs$.next([])}>
      Cancel
    </button>
    <button
      type="button"
      class="app-button app-button-primary"
      disabled={busy || !picked || program < 0 || (adding && !name.trim())}
      onclick={link}
    >
      {adding ? 'Add game' : 'Link and play'}
    </button>
  </footer>
</section>

<style>
  .ng {
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

  .ng-title {
    font-size: var(--type-h2);
    font-weight: 700;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .ng-lead {
    margin-top: -1rem;
    color: var(--app-muted-fg);
  }

  .ng-step,
  .ng-field {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .ng-label {
    font-size: var(--type-label);
    font-weight: 700;
  }

  .ng-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .ng-path {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--type-small);
  }

  .ng-dim {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .ng-warn {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .ng-programs {
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--font-color);
    list-style: none;
  }

  .ng-programs li {
    border-bottom: 1px solid var(--border-color);
  }

  .ng-program {
    display: flex;
    min-height: var(--app-control-height, 2.5rem);
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .ng-program input {
    flex: none;
    accent-color: var(--accent-color);
  }

  .ng-program span:first-of-type {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .ng-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
