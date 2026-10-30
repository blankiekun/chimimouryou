<script lang="ts">
  /** The manga reader's (/m) settings aside, beside the page. Not upstream. */
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import {
    optionsForToggle,
    type ToggleOption
  } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import type { MangaText } from '$lib/data/mokuro';
  import { mangaText$ } from '$lib/data/mokuro';
  import {
    mangaBackground$,
    mangaDoubleTapZoom$,
    mangaDualPage$,
    mangaKeepScreenOn$,
    mangaPageNumber$,
    mangaScale$,
    mangaTapInvert$,
    mangaTapLayout$,
    seriesReadingMode,
    type MangaBackground,
    type MangaDualPage,
    type MangaReadingMode,
    type MangaScale,
    type MangaTapInvert,
    type MangaTapLayout
  } from '$lib/data/manga';

  interface Props {
    /** The series the reading mode is kept for */
    series?: string;
    readingMode: ReturnType<typeof seriesReadingMode>;
    modes: ToggleOption<MangaReadingMode>[];
    textModes: ToggleOption<MangaText>[];
    mode: MangaReadingMode;
    dual: boolean;
    shift: boolean;
    hasText: boolean;
    wakeLockSupported: boolean;
    onclose: () => void;
  }

  let {
    series,
    readingMode,
    modes,
    textModes,
    mode,
    dual,
    shift = $bindable(),
    hasText,
    wakeLockSupported,
    onclose
  }: Props = $props();

  const tapLayouts: ToggleOption<MangaTapLayout>[] = [
    { id: 'default', text: 'Default' },
    { id: 'l', text: 'L shape' },
    { id: 'kindle', text: 'Kindle' },
    { id: 'edge', text: 'Edge' },
    { id: 'sides', text: 'Sides' },
    { id: 'off', text: 'Off' }
  ];
  const tapInverts: ToggleOption<MangaTapInvert>[] = [
    { id: 'none', text: 'None' },
    { id: 'horizontal', text: 'Horizontal' },
    { id: 'vertical', text: 'Vertical' },
    { id: 'both', text: 'Both' }
  ];
  const scales: ToggleOption<MangaScale>[] = [
    { id: 'screen', text: 'Screen' },
    { id: 'width', text: 'Width' },
    { id: 'height', text: 'Height' },
    { id: 'original', text: 'Original' },
    { id: 'smart', text: 'Smart' }
  ];
  const dualPages: ToggleOption<MangaDualPage>[] = [
    { id: 'auto', text: 'Auto' },
    { id: 'on', text: 'On' },
    { id: 'off', text: 'Off' }
  ];
  const backgrounds: ToggleOption<MangaBackground>[] = [
    { id: 'black', text: 'Black' },
    { id: 'gray', text: 'Gray' },
    { id: 'white', text: 'White' },
    { id: 'auto', text: 'Auto' }
  ];
</script>

<div class="manga-scrim" aria-hidden="true" onclick={onclose}></div>
<aside class="manga-settings" aria-label="Manga settings">
  <h2 class="manga-settings-title">Manga</h2>
  <SectionHead number={1} title="Reading" level="h3" />
  <SettingsItemGroup
    title="Reading mode"
    wide
    tooltip={series ? `Kept for this series: ${series}` : 'Kept for manga outside a series.'}
  >
    <ButtonToggleGroup options={modes} bind:selectedOptionId={$readingMode} />
  </SettingsItemGroup>
  {#if mode !== 'vertical'}
    <SettingsItemGroup
      title="Two-page spreads"
      tooltip="Auto shows spreads on screens wider than tall. Cover, wide and last pages stay single; Shift pairs the cover too."
    >
      <div class="flex items-center gap-2">
        <ButtonToggleGroup options={dualPages} bind:selectedOptionId={$mangaDualPage$} />
        {#if dual}
          <button class="app-button" aria-pressed={shift} onclick={() => (shift = !shift)}>
            Shift
          </button>
        {/if}
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup title="Scale">
      <ButtonToggleGroup options={scales} bind:selectedOptionId={$mangaScale$} />
    </SettingsItemGroup>
  {/if}
  <div class="manga-section"><SectionHead number={2} title="Taps" level="h3" /></div>
  <SettingsItemGroup
    title="Tap zones"
    wide
    tooltip="Where a tap turns the page. Default is the sides for pages and an L shape for the vertical strip (top and left back, bottom and right forward)."
  >
    <ButtonToggleGroup options={tapLayouts} bind:selectedOptionId={$mangaTapLayout$} />
  </SettingsItemGroup>
  {#if $mangaTapLayout$ !== 'off'}
    <SettingsItemGroup title="Invert">
      <ButtonToggleGroup options={tapInverts} bind:selectedOptionId={$mangaTapInvert$} />
    </SettingsItemGroup>
  {/if}
  {#if mode !== 'vertical'}
    <SettingsItemGroup title="Double tap to zoom" tooltip="Single taps then wait a moment.">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$mangaDoubleTapZoom$} />
    </SettingsItemGroup>
  {/if}
  <div class="manga-section"><SectionHead number={3} title="Display" level="h3" /></div>
  <SettingsItemGroup title="Background">
    <ButtonToggleGroup options={backgrounds} bind:selectedOptionId={$mangaBackground$} />
  </SettingsItemGroup>
  <SettingsItemGroup title="Page number">
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$mangaPageNumber$} />
  </SettingsItemGroup>
  {#if wakeLockSupported}
    <SettingsItemGroup title="Keep screen on" tooltip="Wake lock while the reader is open.">
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$mangaKeepScreenOn$} />
    </SettingsItemGroup>
  {/if}
  {#if hasText}
    <SettingsItemGroup title="Text overlay" tooltip="Text recognised by mokuro, for Yomitan.">
      <ButtonToggleGroup options={textModes} bind:selectedOptionId={$mangaText$} />
    </SettingsItemGroup>
  {/if}
</aside>

<style>
  .manga-scrim {
    position: fixed;
    inset: 3.5rem 0 0;
    z-index: 9;
    background: var(--app-overlay-color);
  }

  .manga-settings {
    position: fixed;
    top: 3.5rem;
    right: 0;
    bottom: 0;
    z-index: 11;
    width: min(32.5rem, 100vw);
    overflow-y: auto;
    padding: 1.25rem 1.75rem 2rem;
    border-left: 1px solid var(--border-color);
    background: var(--background-color);
    color: var(--font-color);
    font-family: var(--app-font-ui);
  }

  .manga-settings-title {
    margin: 0 0 1.25rem;
    font-size: var(--type-h2);
    font-weight: 400;
  }

  .manga-section {
    margin-top: 1.75rem;
  }
</style>
