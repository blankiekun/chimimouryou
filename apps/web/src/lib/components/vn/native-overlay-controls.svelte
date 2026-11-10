<script lang="ts">
  /**
   * A game's overlay controls (desktop app only): its mode (Off / Band / Invisible), for Invisible
   * where the text goes (read from the screen, or the manual area), and on /hook (no `folder`: the
   * running game) Adjust, which moves and resizes the area over the game. Settings → Desktop games
   * shows it per game (`folder`), and has the size and opacity.
   */
  import {
    desktopOverlay,
    type GameOverlay,
    type OverlayMode,
    type OverlaySettings
  } from '$lib/data/vn/native-games';
  import { onMount } from 'svelte';

  let { folder }: { folder?: string } = $props();

  const overlay = desktopOverlay();
  let settings = $state<OverlaySettings & { restart: boolean; nextStart?: boolean }>();
  let editing = $state(false);
  const modes: { mode: OverlayMode; label: string }[] = [
    { mode: 'off', label: 'Off' },
    { mode: 'band', label: 'Band' },
    { mode: 'invisible', label: 'Invisible' }
  ];
  const places: { place: GameOverlay['place']; label: string }[] = [
    { place: 'screen', label: 'Screen read' },
    { place: 'area', label: 'Manual area' }
  ];
  /** Band always uses the area; Invisible when set to, or when a screen read finds no match. */
  const adjustable = $derived(!folder && !!settings && settings.mode !== 'off');

  onMount(async () => {
    settings = await overlay?.settings(folder ? { folder } : undefined);
  });

  async function change(changes: Partial<GameOverlay>) {
    settings = await overlay?.settings({ ...changes, folder });
    if (settings?.mode === 'off') editing = false;
  }

  async function adjust() {
    editing = (await overlay?.edit(!editing)) ?? false;
  }
</script>

{#if overlay && settings}
  <div class="ov-controls">
    <div class="ov-field">
      <span aria-hidden="true">Text overlay</span>
      <div class="app-segmented" role="radiogroup" aria-label="Text overlay over the game">
        {#each modes as { mode, label } (mode)}
          <button
            type="button"
            role="radio"
            class="app-segment"
            class:app-segment-selected={settings.mode === mode}
            aria-checked={settings.mode === mode}
            onclick={() => change({ mode })}>{label}</button
          >
        {/each}
      </div>
    </div>
    {#if settings.mode === 'invisible'}
      <div class="ov-field">
        <span aria-hidden="true">Placement</span>
        <div class="app-segmented" role="radiogroup" aria-label="Placement of the invisible text">
          {#each places as { place, label } (place)}
            <button
              type="button"
              role="radio"
              class="app-segment"
              class:app-segment-selected={settings.place === place}
              aria-checked={settings.place === place}
              onclick={() => change({ place })}>{label}</button
            >
          {/each}
        </div>
      </div>
    {/if}
    {#if adjustable}
      <button type="button" class="app-button" onclick={adjust}>
        {editing ? 'Done adjusting' : 'Adjust area'}
      </button>
    {/if}
  </div>
  {#if settings.restart || settings.nextStart || settings.mode !== 'off'}
    <p class="ov-note" role="status">
      {#if settings.restart}
        Restart the app to use the overlay (Wayland).
      {:else if settings.nextStart && settings.mode === 'off'}
        The game confines the pointer again from its next start.
      {:else if settings.nextStart}
        Restart the game for lookups while it’s fullscreen.
      {:else if settings.mode === 'band'}
        The current line on a band over the game, for lookups.
      {:else if settings.mode === 'invisible' && settings.place === 'screen'}
        Lookups on the game’s own text: the line is found on the screen, and falls back to the area.
      {:else if settings.mode === 'invisible'}
        Lookups on the game’s own text: fit the area and the text size to the game’s text box.
      {/if}
    </p>
  {/if}
{/if}

<style>
  .ov-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
  }

  .ov-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .ov-note {
    margin: 0.5rem 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
