<script lang="ts">
  /**
   * Settings → Desktop games (desktop app only): where this computer's Windows games are
   * installed (the app's native-games.json, native-games.ts), with Change folder and Forget, and
   * on Linux what runs them (Wine or a Proton build, for all and per game), and the game overlay's text size and opacity (on/off
   * and Band's area are on /hook), and the global shortcuts while a game runs (hotkeys.js).
   * Each game's Steam launch option (`--game=<folder>`, main.js), and diagnostics with the log
   * file's end for reports (Steam Deck's Game Mode has no terminal).
   */
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import NativeGameDialog from '$lib/components/vn/native-game-dialog.svelte';
  import NativeOverlayControls from '$lib/components/vn/native-overlay-controls.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import {
    desktopGames,
    desktopOverlay,
    type NativeHotkeys,
    type OverlaySettings,
    type NativeGameEntry,
    type NativeGamesList,
    type NativeRunner
  } from '$lib/data/vn/native-games';
  import { onMount } from 'svelte';

  const games = desktopGames()!;
  let list = $state<NativeGamesList>();

  const overlay = desktopOverlay();
  let overlaySettings = $state<OverlaySettings>();
  const refresh = async () => (list = await games.list());
  let hotkeys = $state<NativeHotkeys & { failed: string[] }>();
  const hotkeyFields: { action: keyof NativeHotkeys; label: string }[] = [
    { action: 'mine', label: 'Newest line to the last Anki card' },
    { action: 'show', label: 'Show the texthooker (again: back to the game)' }
  ];

  onMount(async () => {
    overlaySettings = await overlay?.settings();
    hotkeys = await games.hotkeys();
    await refresh();
  });

  async function setOverlay(changes: Partial<OverlaySettings>) {
    overlaySettings = await overlay?.settings(changes);
  }

  /** A runner as a select's value: 'auto', 'wine' or a Proton build's folder. */
  const runnerValue = (runner: NativeRunner) =>
    typeof runner === 'string' ? runner : runner.proton;

  /** Linux: what starts the games, for all (no folder) or one ('' = as the others). */
  async function setRunner(folder: string | undefined, value: string) {
    const runner = value === 'auto' || value === 'wine' ? value : { proton: value };
    await games.runner(folder, value ? runner : undefined);
    await refresh();
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

  /** What the last Copy did, said beside its button */
  let copied = $state<{ what: string; text: string }>();

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = { what, text: 'Copied.' };
    } catch {
      copied = { what, text: 'The clipboard refused it.' };
    }
  }

  /** A runner as the selects name it. */
  const runnerName = (runner: NativeRunner) =>
    runner === 'auto'
      ? 'Automatic'
      : runner === 'wine'
        ? 'Wine'
        : (list?.proton?.find((build) => build.path === runner.proton)?.name ?? runner.proton);

  /** For a bug report: this computer, what runs the games, and the log file's last lines. */
  async function copyDiagnostics() {
    const info = await games.diagnostics();
    const yes = (value?: boolean) => (value ? 'yes' : 'no');
    const linux = list?.platform === 'linux';
    const lines = [
      `chimimouryou ${info.version}`,
      `OS: ${info.os}`,
      `Session: ${info.session}`,
      `Text hook bundled: ${yes(list?.hook)}`,
      ...(linux && list
        ? [
            `Runs games with: ${runnerName(list.runner ?? 'auto')}`,
            `Starts them with: ${list.runs?.error ?? `${list.runs?.kind} ${list.runs?.name ?? ''}`.trim()}`,
            `Wine: ${list.wine?.version ?? 'not installed'}, ja_JP.UTF-8 ${yes(list.wine?.japaneseLocale)}, winetricks ${yes(list.wine?.winetricks)}`,
            ...(list.proton ?? []).map(
              (build) =>
                `Proton: ${build.name} (${build.path})${build.needs ? `, needs ${build.needs}` : ''}`
            ),
            ...list.games
              .filter((game) => game.runner)
              .map((game) => `Game ${game.folder} runs with ${runnerName(game.runner!)}`),
            `pactl: ${yes(info.pactl)}, parec: ${yes(info.parec)}`
          ]
        : []),
      '',
      'Log:',
      ...info.log
    ];
    await copy('diagnostics', lines.join('\n'));
  }
</script>

<SettingsSection
  id="general-desktop-games"
  keywords="desktop games windows native wine proton steam deck install folder hook texthooker"
>
  {#if list?.platform === 'linux'}
    <SettingsItemGroup
      title="Runs games with"
      tooltip="Wine installed on this computer, or a Proton build from Steam (Library → Tools), each game in its own prefix. Automatic takes Wine when it is installed, else the newest Proton. Saves are copied over when a game changes."
    >
      <div class="dg-runner">
        <select
          class="app-input"
          aria-label="Runs games with"
          value={runnerValue(list.runner ?? 'auto')}
          onchange={(event) => setRunner(undefined, event.currentTarget.value)}
        >
          <option value="auto">Automatic</option>
          <option value="wine">Wine</option>
          {#each list.proton ?? [] as build (build.path)}
            <option value={build.path}
              >{build.name}{build.needs ? ' (runtime not installed)' : ''}</option
            >
          {/each}
        </select>
        <ul class="dg-checks">
          {#if list.runs?.error}
            <li class="dg-missing">{list.runs.error}</li>
          {:else if list.runs?.kind === 'proton'}
            <li>{list.runs.name}, from Steam</li>
            <li>Japanese locale, Tokyo time and font replacements are set by the app</li>
          {:else}
            <li>{list.wine?.version}</li>
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
          {/if}
        </ul>
      </div>
    </SettingsItemGroup>
  {/if}
  {#if overlaySettings && list?.hook}
    <SettingsItemGroup
      title="Game overlay"
      tooltip="The current line over the game, for lookups. Each game below has its own mode; adjust its area on the texthooker page while the game runs. Size and opacity are for the band."
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
  {#if hotkeys && list?.hook}
    <SettingsItemGroup
      title="Shortcuts while a game runs"
      tooltip="Global shortcuts that work with the game in front, set only while a game runs. Electron's format, such as CommandOrControl+Shift+M; empty turns one off."
    >
      <div class="dg-keys">
        {#each hotkeyFields as { action, label } (action)}
          <label class="dg-field">
            <input
              class="app-input"
              value={hotkeys[action]}
              spellcheck="false"
              placeholder="Off"
              onchange={async (event) =>
                (hotkeys = await games.hotkeys({ [action]: event.currentTarget.value }))}
            />
            {label}
            {#if hotkeys.failed.includes(action)}
              <span class="dg-missing">Not set: another program has it, or it isn’t a shortcut</span
              >
            {/if}
          </label>
        {/each}
      </div>
    </SettingsItemGroup>
  {/if}
  {#if list}
    <SettingsItemGroup
      title="Diagnostics"
      tooltip="For a bug report: this computer, what runs the games, and the end of the app's log file (no keys, tokens or game text)."
    >
      <div class="dg-actions">
        <button type="button" class="app-button" onclick={copyDiagnostics}>Copy diagnostics</button>
        <button type="button" class="app-button app-button-quiet" onclick={() => games.openLogs()}>
          Open log folder
        </button>
        {#if copied?.what === 'diagnostics'}<span class="dg-note">{copied.text}</span>{/if}
      </div>
    </SettingsItemGroup>
  {/if}
  {#if list?.hook && list.games.length}
    <p class="dg-note">
      To start a game from Steam, add this app as a non-Steam game{list.appImage
        ? ` (target: ${list.appImage})`
        : ''} and paste the game's Steam launch option into its Launch Options. The app then starts the
      game itself, which Steam's Game Mode needs to show the overlay over it.
    </p>
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
      {#if list?.hook}
        <NativeOverlayControls folder={game.folder} />
      {/if}
      <div class="dg-actions">
        <button type="button" class="app-button" onclick={() => changeFolder(game)}>
          Change folder
        </button>
        <button type="button" class="app-button app-button-quiet" onclick={() => forget(game)}>
          Forget
        </button>
        {#if list?.hook}
          <button
            type="button"
            class="app-button app-button-quiet"
            onclick={() => copy(game.folder, `--game=${game.folder}`)}
          >
            Copy Steam launch option
          </button>
          {#if copied?.what === game.folder}<span class="dg-note">{copied.text}</span>{/if}
        {/if}
        {#if list?.platform === 'linux'}
          <select
            class="app-input dg-game-runner"
            aria-label={`Runs ${game.title} with`}
            value={game.runner ? runnerValue(game.runner) : ''}
            onchange={(event) => setRunner(game.folder, event.currentTarget.value)}
          >
            <option value="">Same as the others</option>
            <option value="wine">Wine</option>
            {#each list.proton ?? [] as build (build.path)}
              <option value={build.path}
                >{build.name}{build.needs ? ' (runtime not installed)' : ''}</option
              >
            {/each}
          </select>
        {/if}
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

  .dg-runner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .dg-runner select,
  .dg-game-runner {
    width: auto;
    max-width: 100%;
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

  .dg-keys {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: var(--type-small);
  }

  .dg-keys input {
    width: 16rem;
  }

  .dg-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .dg-actions .dg-note {
    align-self: center;
  }
</style>
