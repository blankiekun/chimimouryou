<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import {
    ankiAudioField$,
    ankiConnectUrl$,
    ankiEnabled$,
    ankiInvoke,
    ankiBookAiFallback$,
    ankiBookAudio$,
    ankiPictureField$,
    ankiSentenceField$,
    ankiVnAudio$,
    ankiVnScreenshot$
  } from '$lib/data/anki';
  import { learningGuideUrl } from '$lib/data/app-update';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';

  const origin = typeof location === 'undefined' ? '' : location.origin;

  $: toggle = [
    { id: false, text: $t$('settings.off') },
    { id: true, text: $t$('settings.on') }
  ] as ToggleOption<boolean>[];

  let testResult = '';
  let testState: 'busy' | 'ok' | 'error' = 'busy';

  async function test() {
    testState = 'busy';
    testResult = $t$('anki.connecting');
    try {
      testResult = $t$('anki.connected', { version: await ankiInvoke<number>('version') });
      testState = 'ok';
    } catch (error: any) {
      testResult = error.message;
      testState = 'error';
    }
  }
</script>

<SettingsSection id="anki-connect">
  <SettingsItemGroup title={$t$('anki.enabled')} tooltip={$t$('anki.enabledHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiEnabled$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.guide')}>
    <a class="app-button app-button-quiet" href={learningGuideUrl} target="_blank" rel="noreferrer">
      {$t$('anki.guideLink')}
    </a>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.url')} tooltip={$t$('anki.urlHint', { origin })} wide>
    <span class="anki-url">
      <input
        id="anki-connect-url"
        aria-label={$t$('anki.url')}
        autocomplete="off"
        class="app-input"
        bind:value={$ankiConnectUrl$}
      />
      <button class="app-button" on:click={test}>{$t$('anki.test')}</button>
    </span>
    {#if testResult}
      <p class="anki-status" data-state={testState} role="status">{testResult}</p>
    {/if}
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.sentenceField')} tooltip={$t$('anki.sentenceFieldHint')}>
    <input
      aria-label={$t$('anki.sentenceField')}
      class="app-input"
      bind:value={$ankiSentenceField$}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.audioField')} tooltip={$t$('anki.audioFieldHint')}>
    <input aria-label={$t$('anki.audioField')} class="app-input" bind:value={$ankiAudioField$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.pictureField')} tooltip={$t$('anki.pictureFieldHint')}>
    <input
      aria-label={$t$('anki.pictureField')}
      class="app-input"
      bind:value={$ankiPictureField$}
    />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="anki-media">
  <SettingsItemGroup title={$t$('anki.bookAudio')} tooltip={$t$('anki.bookAudioHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiBookAudio$} />
  </SettingsItemGroup>
  {#if $activePlugins$.some((plugin) => plugin.ankiSentenceAudio)}
    <SettingsItemGroup title={$t$('anki.aiFallback')} tooltip={$t$('anki.aiFallbackHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiBookAiFallback$} />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('anki.vnScreenshot')} tooltip={$t$('anki.vnScreenshotHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiVnScreenshot$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.vnAudio')} tooltip={$t$('anki.vnAudioHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiVnAudio$} />
  </SettingsItemGroup>
</SettingsSection>

<style>
  .anki-url {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .anki-url input {
    width: 19rem;
    max-width: 100%;
  }

  .anki-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.6rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .anki-status::before {
    content: '';
    width: 0.45rem;
    height: 0.45rem;
    flex: none;
    border-radius: 9999px;
    background: var(--app-muted-fg);
  }

  .anki-status[data-state='ok'] {
    color: var(--font-color);
  }

  .anki-status[data-state='ok']::before {
    background: var(--app-success-color);
  }

  .anki-status[data-state='error'] {
    color: var(--app-danger-color);
  }

  .anki-status[data-state='error']::before {
    background: var(--app-danger-color);
  }
</style>
