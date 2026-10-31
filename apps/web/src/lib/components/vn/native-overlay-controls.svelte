<script lang="ts">
  /**
   * /hook's overlay controls for a game played natively (desktop app only): the overlay on/off
   * and Adjust (move and resize its text box area over the game). Size and opacity: Settings →
   * Desktop games.
   */
  import { desktopOverlay, type OverlaySettings } from '$lib/data/vn/native-games';
  import { onMount } from 'svelte';

  const overlay = desktopOverlay();
  let settings = $state<OverlaySettings & { restart: boolean }>();
  let editing = $state(false);

  onMount(async () => {
    settings = await overlay?.settings();
  });

  async function toggle(on: boolean) {
    settings = await overlay?.settings({ on });
    if (!on) editing = false;
  }

  async function adjust() {
    editing = (await overlay?.edit(!editing)) ?? false;
  }
</script>

{#if overlay && settings}
  <div class="ov-controls">
    <label>
      <input
        type="checkbox"
        checked={settings.on}
        onchange={(event) => toggle(event.currentTarget.checked)}
      />
      Text overlay over the game
    </label>
    {#if settings.on}
      <button type="button" class="app-button" onclick={adjust}>
        {editing ? 'Done adjusting' : 'Adjust overlay'}
      </button>
    {/if}
  </div>
  {#if settings.restart}
    <p class="ov-note" role="status">Restart the app to use the overlay (Wayland).</p>
  {/if}
{/if}

<style>
  .ov-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .ov-controls label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .ov-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
