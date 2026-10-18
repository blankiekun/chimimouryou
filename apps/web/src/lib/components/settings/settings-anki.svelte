<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import {
    ankiAudioField$,
    ankiConnectUrl$,
    ankiEnabled$,
    ankiInvoke,
    ankiKnownDeck$,
    ankiKnownField$,
    ankiKnownWords$,
    ankiBookAiFallback$,
    ankiBookAudio$,
    ankiPictureField$,
    ankiSentenceField$,
    ankiVnAudio$,
    ankiVnScreenshot$
  } from '$lib/data/anki';
  import { learningGuideUrl } from '$lib/data/app-update';
  import { getKnownWords, knownWords$, refreshKnownWords } from '$lib/data/known-words';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import { onMount } from 'svelte';

  const origin = typeof location === 'undefined' ? '' : location.origin;

  $: toggle = [
    { id: false, text: $t$('settings.off') },
    { id: true, text: $t$('settings.on') }
  ] as ToggleOption<boolean>[];

  let testResult = '';
  let decks: string[] = [];
  let refreshing = false;
  let refreshError = '';

  onMount(() => {
    getKnownWords().catch(() => undefined);
  });

  $: if ($ankiKnownWords$ && !decks.length) {
    ankiInvoke<string[]>('deckNames').then(
      (names) => (decks = names),
      () => {}
    );
  }

  async function refreshKnown() {
    refreshing = true;
    refreshError = '';
    try {
      await refreshKnownWords();
    } catch (error: any) {
      refreshError = error.message;
    } finally {
      refreshing = false;
    }
  }

  async function test() {
    testResult = $t$('anki.connecting');
    try {
      testResult = $t$('anki.connected', { version: await ankiInvoke<number>('version') });
    } catch (error: any) {
      testResult = error.message;
    }
  }
</script>
<SettingsSection id="anki-connect">
  <SettingsItemGroup title={$t$('anki.enabled')} tooltip={$t$('anki.enabledHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiEnabled$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.guide')}>
    <a class="underline" href={learningGuideUrl} target="_blank" rel="noreferrer">
      {$t$('anki.guideLink')}
    </a>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.url')} tooltip={$t$('anki.urlHint', { origin })}>
    <input
      id="anki-connect-url"
      aria-label={$t$('anki.url')}
      autocomplete="off"
      class={inputClasses}
      bind:value={$ankiConnectUrl$}
    />
    <button class="{buttonClasses} mt-2" on:click={test}>{$t$('anki.test')}</button>
    {#if testResult}<p class="mt-2 text-xs text-[color:var(--app-muted-fg)]">{testResult}</p>{/if}
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.sentenceField')} tooltip={$t$('anki.sentenceFieldHint')}>
    <input
      aria-label={$t$('anki.sentenceField')}
      class={inputClasses}
      bind:value={$ankiSentenceField$}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.audioField')} tooltip={$t$('anki.audioFieldHint')}>
    <input aria-label={$t$('anki.audioField')} class={inputClasses} bind:value={$ankiAudioField$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.pictureField')} tooltip={$t$('anki.pictureFieldHint')}>
    <input
      aria-label={$t$('anki.pictureField')}
      class={inputClasses}
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

<SettingsSection id="anki-known">
  <SettingsItemGroup title={$t$('anki.known')} tooltip={$t$('anki.knownHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiKnownWords$} />
  </SettingsItemGroup>
  {#if $ankiKnownWords$}
    <SettingsItemGroup title={$t$('anki.deck')} tooltip={$t$('anki.deckHint')}>
      <input
        aria-label={$t$('anki.deck')}
        autocomplete="off"
        class={inputClasses}
        list="anki-known-decks"
        bind:value={$ankiKnownDeck$}
      />
      <datalist id="anki-known-decks">
        {#each decks as deck}<option value={deck} />{/each}
      </datalist>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('anki.wordField')} tooltip={$t$('anki.wordFieldHint')}>
      <input aria-label={$t$('anki.wordField')} class={inputClasses} bind:value={$ankiKnownField$} />
      <button class="{buttonClasses} mt-2" disabled={refreshing} on:click={refreshKnown}>
        {refreshing ? $t$('anki.reading') : $t$('anki.refresh')}
      </button>
      <p class="mt-2 text-xs text-[color:var(--app-muted-fg)]">
        {#if refreshError}{refreshError}{:else if $knownWords$}{$t$('anki.knownCount', {
            count: $knownWords$.words.length.toLocaleString('en-US'),
            date: new Date($knownWords$.read).toLocaleString()
          })}{:else}{$t$('anki.notRead')}{/if}
      </p>
    </SettingsItemGroup>
  {/if}
</SettingsSection>
