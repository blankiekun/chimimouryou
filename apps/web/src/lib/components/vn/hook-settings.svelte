<script lang="ts">
  /**
   * /hook's Settings sheet: the lines' layout, a second tool's address, the text cleanup and
   * setting presets (after texthooker-ui, MIT). Per computer, in localStorage (texthooker.ts),
   * never synced. A natively played game's cleanup is its own, saved on its record by the page.
   * Not upstream.
   */
  import SectionHead from '$lib/components/section-head.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
  import HookCleanupEditor from '$lib/components/vn/hook-cleanup-editor.svelte';
  import type { HookCleanup } from '$lib/data/vn/hook-cleanup';
  import {
    applyPreset,
    currentPreset,
    deletePreset,
    hookFlash$,
    hookFontSize$,
    hookPresets,
    hookReverse$,
    hookSettingPresets$,
    hookSocketUrl2$,
    maxFontSize,
    maxPresetName,
    maxPresets,
    minFontSize,
    savePreset,
    type HookStatus
  } from '$lib/data/vn/texthooker';

  interface Props {
    /** A game played natively: no WebSocket settings, and no presets (they carry those) */
    native: boolean;
    cleanup: HookCleanup;
    /** Raw lines as sent, newest last, for the cleanup's preview and suggestion */
    raw: string[];
    status2: HookStatus;
    oncleanup: (cleanup: HookCleanup) => void;
    /** The second address changed, or a preset was loaded: reconnect */
    onreconnect: () => void;
  }

  let { native, cleanup, raw, status2, oncleanup, onreconnect }: Props = $props();

  const statusText: Record<HookStatus, string> = {
    connecting: 'Connecting…',
    connected: 'Connected',
    closed: 'Not connected, retrying',
    blocked: 'Blocked by the browser',
    invalid: 'Not a ws:// or wss:// address',
    off: 'Off'
  };

  let url2 = $state(hookSocketUrl2$.getValue());
  let presetName = $state('');
  let presetNote = $state('');

  function setUrl2() {
    hookSocketUrl2$.next(url2.trim());
    onreconnect();
  }

  function save() {
    const preset = currentPreset(presetName);

    presetNote = savePreset(preset)
      ? `Saved “${preset.name}”.`
      : preset.name
        ? `Up to ${maxPresets} presets: delete one first.`
        : 'Name the preset first.';
  }

  function load(name: string) {
    const preset = $hookSettingPresets$.find((other) => other.name === name);

    if (!preset) return;
    applyPreset(preset);
    url2 = preset.url2;
    presetName = preset.name;
    presetNote = `Loaded “${preset.name}”.`;
    onreconnect();
  }
</script>

<div class="hs">
  <SectionHead number={1} title="Layout" level="h3" />
  <SettingsItemGroup title="Text size" tooltip="{minFontSize}–{maxFontSize} px">
    <input
      class="app-input hs-number"
      type="number"
      aria-label="Text size in px"
      min={minFontSize}
      max={maxFontSize}
      value={$hookFontSize$}
      onchange={(event) => hookFontSize$.next(+event.currentTarget.value)}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title="Newest line first">
    <ButtonToggleGroup
      options={optionsForToggle}
      bind:selectedOptionId={() => $hookReverse$, (on) => hookReverse$.next(on)}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title="Light up new lines">
    <ButtonToggleGroup
      options={optionsForToggle}
      bind:selectedOptionId={() => $hookFlash$, (on) => hookFlash$.next(on)}
    />
  </SettingsItemGroup>

  {#if !native}
    <SectionHead number={2} title="Second tool" level="h3" />
    <label class="hs-field">
      <span>WebSocket address <span class="hs-muted">(empty for none)</span></span>
      <input
        class="app-input"
        bind:value={url2}
        onchange={setUrl2}
        spellcheck="false"
        autocomplete="off"
        list="hook-presets-2"
        placeholder="ws://localhost:9001"
      />
      <datalist id="hook-presets-2">
        {#each hookPresets as preset (preset.url)}
          <option value={preset.url}>{preset.label}</option>
        {/each}
      </datalist>
    </label>
    {#if $hookSocketUrl2$}
      <p class="hs-muted" role="status">{statusText[status2]}</p>
    {/if}
  {/if}

  <SectionHead number={native ? 2 : 3} title="Text cleanup" level="h3" />
  <p class="hs-muted">
    {native ? 'Saved with this game.' : 'For the WebSocket lines; pasted lines stay as they are.'}
  </p>
  <HookCleanupEditor {cleanup} last={raw.at(-1)} recent={raw} onchange={oncleanup} />

  {#if !native}
    <SectionHead number={4} title="Presets" level="h3" count={$hookSettingPresets$.length} />
    <p class="hs-muted">Addresses, layout and cleanup under one name.</p>
    {#if $hookSettingPresets$.length}
      <ul class="hs-presets">
        {#each $hookSettingPresets$ as preset (preset.name)}
          <li>
            <span class="hs-preset-name">{preset.name}</span>
            <button type="button" class="app-button" onclick={() => load(preset.name)}>Load</button>
            <button
              type="button"
              class="app-button app-button-quiet"
              onclick={() => {
                deletePreset(preset.name);
                presetNote = `Deleted “${preset.name}”.`;
              }}
            >
              Delete
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form
      class="hs-row"
      onsubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        class="app-input hs-grow"
        aria-label="Preset name"
        placeholder="Preset name"
        maxlength={maxPresetName}
        bind:value={presetName}
      />
      <button class="app-button app-button-primary" disabled={!presetName.trim()}>Save</button>
    </form>
    {#if presetNote}
      <p class="hs-muted" role="status">{presetNote}</p>
    {/if}
  {/if}
</div>

<style>
  .hs {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
  }

  .hs :global(.section-head) {
    margin-top: 0.75rem;
  }

  .hs-muted {
    margin: 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hs-number {
    width: 5rem;
    font-variant-numeric: tabular-nums;
  }

  .hs-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--type-small);
  }

  .hs-row {
    display: flex;
    gap: 0.5rem;
  }

  .hs-grow {
    min-width: 0;
    flex: 1;
  }

  .hs-presets {
    margin: 0;
    padding: 0;
    border-top: 2px solid var(--font-color);
    list-style: none;
  }

  .hs-presets li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .hs-preset-name {
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
    font-weight: 700;
  }
</style>
