<script lang="ts">
  /**
   * /hook's start options for a game played natively, while it isn't running (desktop app only):
   * Launch only (no built-in hook: lines come from the reader's own tool over the WebSocket), kept
   * per game on this computer, and Attach to running game, picked by its index in main's list.
   */
  import { desktopGames } from '$lib/data/vn/native-games';

  interface Props {
    folder: string;
    /** Undefined while the game isn't linked on this computer */
    launchOnly: boolean | undefined;
    onattach: (index: number) => void;
  }

  let { folder, launchOnly = $bindable(), onattach }: Props = $props();
  const games = desktopGames()!;
  let windows = $state<{ title: string; exe: string }[]>();
  let listing = $state(false);
  let note = $state('');

  async function setLaunchOnly(on: boolean) {
    launchOnly = (await games.options(folder, { launchOnly: on }))?.launchOnly;
  }

  async function list() {
    listing = true;
    note = '';
    const result = await games.windows(folder);

    listing = false;
    windows = result.status === 'ok' ? result.windows : undefined;
    if (result.status === 'ok') {
      if (!result.windows.length) note = 'No program with a window is running.';
    } else if (result.status === 'error') note = result.message;
    else if (result.status === 'missing') note = 'Link the game’s folder first: Start the game.';
    else note = 'This build of the app can’t hook games.';
  }
</script>

<div class="so">
  <div class="so-actions">
    {#if launchOnly !== undefined}
      <label>
        <input
          type="checkbox"
          checked={launchOnly}
          onchange={(event) => setLaunchOnly(event.currentTarget.checked)}
        />
        Launch only (I hook with my own tool)
      </label>
    {/if}
    <button type="button" class="app-button app-button-quiet" disabled={listing} onclick={list}>
      {listing ? 'Listing programs…' : 'Attach to running game…'}
    </button>
  </div>
  {#if launchOnly}
    <p class="so-note">
      Lines come from Textractor or LunaTranslator at the WebSocket address in Settings.
    </p>
  {/if}
  {#if windows?.length}
    <ul class="so-list" aria-label="Running programs">
      {#each windows as program, index (index)}
        <li>
          <button
            type="button"
            class="so-row"
            onclick={() => {
              windows = undefined;
              onattach(index);
            }}
          >
            <span class="so-title" lang="ja">{program.title}</span>
            <span class="so-exe">{program.exe}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if note}<p class="so-note" role="status">{note}</p>{/if}
</div>

<style>
  .so {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .so-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .so-actions label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .so-note,
  .so-exe {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .so-list {
    max-height: 16rem;
    overflow-y: auto;
    border-top: 2px solid var(--font-color);
  }

  .so-list li {
    border-bottom: 1px solid var(--border-color);
  }

  .so-row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  .so-row:hover {
    background: color-mix(in srgb, var(--font-color) 6%, transparent);
  }

  .so-title {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 700;
  }

  .so-exe {
    margin-left: auto;
  }
</style>
