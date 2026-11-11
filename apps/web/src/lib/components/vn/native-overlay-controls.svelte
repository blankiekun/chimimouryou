<script lang="ts">
  /**
   * A game's overlay controls (desktop app only): its mode (Off / Band / Invisible), and on /hook
   * (no `folder`: the running game) Band's Adjust, which moves and resizes its area over the game,
   * and why Invisible shows nothing for the line (the overlay page's `status`). Settings → Desktop
   * games shows it per game (`folder`), and has the size and opacity.
   */
  import {
    desktopOverlay,
    overlayChannel,
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
  /** Only Band has an area; Invisible goes on the game's own text. */
  const adjustable = $derived(!folder && settings?.mode === 'band');
  let status = $state('');

  onMount(() => {
    overlay?.settings(folder ? { folder } : undefined).then((value) => (settings = value));
    if (folder) return;
    const channel = new BroadcastChannel(overlayChannel);
    channel.onmessage = ({ data }) => {
      if (typeof data?.status === 'string') status = data.status;
      if (data?.editing === false) editing = false;
    };
    return () => channel.close();
  });

  async function change(changes: Partial<GameOverlay>) {
    settings = await overlay?.settings({ ...changes, folder });
    if (settings?.mode !== 'band') editing = false;
    status = '';
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
      {:else if settings.mode === 'invisible' && status}
        {status}
      {:else if settings.mode === 'invisible'}
        Hover the game’s own text to look it up.
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
