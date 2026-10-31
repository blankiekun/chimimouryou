<script lang="ts">
  /**
   * Settings → Desktop games (desktop app only): where this computer's Windows games are
   * installed (the app's native-games.json, native-games.ts), with Change folder and Forget, and
   * on Linux whether Wine is ready to run them, and the game overlay's text size and opacity (on/off
   * and its place are on /hook).
   */
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import NativeGameDialog from '$lib/components/vn/native-game-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import {
    desktopGames,
    desktopOverlay,
    type OverlaySettings,
    type NativeGameEntry,
    type NativeGamesList
  } from '$lib/data/vn/native-games';
  import { onMount } from 'svelte';

  const games = desktopGames()!;
  let list = $state<NativeGamesList>();

  const overlay = desktopOverlay();
  let overlaySettings = $state<OverlaySettings>();
  const refresh = async () => (list = await games.list());

  onMount(async () => {
    overlaySettings = await overlay?.settings();
    await refresh();
  });

  async function setOverlay(changes: Partial<OverlaySettings>) {
    overlaySettings = await overlay?.settings(changes);
  }

  function changeFolder(game: NativeGameEntry) {
    dialogManager.dialogs$.next([
      {
        component: NativeGameDialog as any,
        props: {
          title: game.title,
          folder: game.folder,
          exe: game.exe,
          gone: game.present ? undefined : game.installDir,
          done: refresh
        },
        disableCloseOnClick: true
      }
    ]);
  }

  async function forget(game: NativeGameEntry) {
    await games.forget(game.folder);
    await refresh();
  }
</script>

<SettingsSection
  id="general-desktop-games"
  keywords="desktop games windows native wine install folder hook texthooker"
>
  {#if list?.platform === 'linux'}
    <SettingsItemGroup
      title="Wine"
      tooltip="Games run in the Wine installed on this computer, each in its own prefix."
    >
      <ul class="dg-checks">
        <li class:dg-missing={!list.wine?.version}>
          {list.wine?.version ?? 'Not found: install Wine'}
        </li>
        <li class:dg-missing={!list.wine?.japaneseLocale}>
          {list.wine?.japaneseLocale
            ? 'Japanese locale (ja_JP.UTF-8)'
            : 'No ja_JP.UTF-8 locale: generate it, or Shift JIS games show garbled text'}
        </li>
        <li class:dg-missing={!list.wine?.winetricks}>
          {list.wine?.winetricks
            ? 'winetricks (Japanese fonts)'
            : 'No winetricks: games may lack Japanese fonts'}
        </li>
      </ul>
    </SettingsItemGroup>
  {/if}
  {#if overlaySettings && list?.hook}
    <SettingsItemGroup
      title="Game overlay"
      tooltip="The current line over the game's text box, for lookups. Turn it on and adjust its place on the texthooker page while a game runs."
    >
      <div class="dg-actions">
        <label class="dg-field">
          Text size
          <input
            class="app-input"
            type="number"
            min="12"
            max="96"
            value={overlaySettings.fontSize}
            onchange={(event) => setOverlay({ fontSize: event.currentTarget.valueAsNumber })}
          />
        </label>
        <label class="dg-field">
          Background opacity (%)
          <input
            class="app-input"
            type="number"
            min="0"
            max="100"
            step="5"
            value={Math.round(overlaySettings.opacity * 100)}
            onchange={(event) => setOverlay({ opacity: event.currentTarget.valueAsNumber / 100 })}
          />
        </label>
      </div>
    </SettingsItemGroup>
  {/if}
  {#if list && !list.hook}
    <p class="dg-note">This build of the app has no built-in text hook, so games can’t start.</p>
  {/if}
  {#if list && !list.games.length}
    <p class="dg-note">
      No games linked yet. Choose More → Play natively in a Windows game, or Import → Installed game
      in the library.
    </p>
  {/if}
  {#each list?.games ?? [] as game (game.folder)}
    <SettingsItemGroup
      title={game.title}
      tooltip={game.present
        ? `${game.installDir} · ${game.exe}`
        : `Not at ${game.installDir} any more`}
    >
      <div class="dg-actions">
        <button type="button" class="app-button" onclick={() => changeFolder(game)}>
          Change folder
        </button>
        <button type="button" class="app-button app-button-quiet" onclick={() => forget(game)}>
          Forget
        </button>
      </div>
    </SettingsItemGroup>
  {/each}
</SettingsSection>

<style>
  .dg-checks {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--type-small);
  }

  .dg-missing {
    color: var(--app-danger-color);
  }

  .dg-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .dg-field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dg-field input {
    width: 5rem;
  }

  .dg-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
