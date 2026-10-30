<script lang="ts">
  /**
   * The VN player's (/v) column under the game (beside it on phones held sideways): notices,
   * the text panel or "ended", and the progress line. Not upstream.
   */
  import type { VnLine } from '$lib/data/vn';

  interface Props {
    /** Set when synced saves were written by a newer engine; Dismiss clears it. */
    newerEngine: string | undefined;
    engineVersion: string | undefined;
    /** Why a Windows game's saves don't sync; Dismiss clears it. */
    savesNote: string | undefined;
    ended: boolean;
    showText: boolean;
    lines: VnLine[];
    /** Characters in the game (unknown for Windows games) */
    characters: number | undefined;
    readCharacters: number;
    todayCharacters: number;
    percent: number;
    /** A tap on the text panel, for the built-in dictionary */
    ontap: (x: number, y: number) => void;
  }

  let {
    newerEngine = $bindable(),
    engineVersion,
    savesNote = $bindable(),
    ended,
    showText,
    lines,
    characters,
    readCharacters,
    todayCharacters,
    percent,
    ontap
  }: Props = $props();
</script>

<div class="vn-side">
  {#if newerEngine}
    <div class="vn-notice">
      <p>
        Some saves come from a newer engine ({newerEngine}, here {engineVersion}). If one doesn't
        load, ask an admin to update it.
      </p>
      <button class="app-button app-button-quiet" onclick={() => (newerEngine = undefined)}>
        Dismiss
      </button>
    </div>
  {/if}

  {#if savesNote}
    <div class="vn-notice">
      <p>{savesNote}</p>
      <button class="app-button app-button-quiet" onclick={() => (savesNote = undefined)}>
        Dismiss
      </button>
    </div>
  {/if}

  {#if ended}
    <p class="vn-text">The game has ended.</p>
  {:else if showText}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="vn-text"
      class:vn-text-ruled={lines.length}
      lang="ja"
      onclick={(event) => ontap(event.clientX, event.clientY)}
    >
      {#each lines as line}
        <p>
          {#each line as part}{#if part.ruby}<ruby>{part.text}<rt>{part.ruby}</rt></ruby
              >{:else}{part.text}{/if}{/each}
        </p>
      {/each}
    </div>
  {/if}

  {#if characters}
    <div class="vn-progress">
      <span class="vn-progress-track">
        <span class="vn-progress-fill" style:width="{percent}%"></span>
      </span>
      <span class="vn-progress-label">
        {readCharacters.toLocaleString('en')} / {characters.toLocaleString('en')} chars ·
        {Math.floor(percent)}%
        {#if todayCharacters}
          <span class="vn-today">+{todayCharacters.toLocaleString('en')} today</span>
        {/if}
      </span>
    </div>
  {/if}
</div>

<style>
  @media (orientation: portrait) and (max-width: 767px) {
    :global(.vn-main-text) .vn-side {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
    }

    /* The text at body size, as tall as it is; the progress stays at the bottom */
    :global(.vn-main-text) .vn-text {
      max-height: none;
      font-size: var(--type-body);
      font-weight: 400;
      line-height: 1.8;
    }

    :global(.vn-main-text) .vn-progress {
      margin-top: auto;
    }
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
    :global(.vn-main-text) .vn-side {
      display: flex;
      width: 40%;
      flex-direction: column;
      border-left: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    }

    :global(.vn-main-text) .vn-text {
      max-height: none;
      flex: 1;
      margin-top: 1rem;
    }

    :global(.vn-main-text) .vn-progress {
      flex-wrap: wrap;
      padding: 0.75rem 1rem;
    }

    :global(.vn-main-text) .vn-progress-track {
      flex-basis: 100%;
    }

    .vn-progress {
      padding: 0.4rem 1rem;
    }
  }
</style>
