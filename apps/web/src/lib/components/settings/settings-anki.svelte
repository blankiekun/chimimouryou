<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
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
  import { activePlugins$ } from '$lib/plugins';
  import { onMount } from 'svelte';

  const origin = typeof location === 'undefined' ? '' : location.origin;

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
    testResult = 'Connecting…';
    try {
      testResult = `Connected (AnkiConnect version ${await ankiInvoke<number>('version')})`;
    } catch (error: any) {
      testResult = error.message;
    }
  }
</script>

<SettingsSection id="anki-connect">
  <SettingsItemGroup
    title="Add media to mined cards"
    tooltip="While a book or visual novel is open, notes added to Anki (e.g. with Yomitan) get the audio and screenshot chosen below."
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ankiEnabled$} />
  </SettingsItemGroup>
  <SettingsItemGroup title="Setup guide">
    <a class="underline" href={learningGuideUrl} target="_blank" rel="noreferrer">
      Yomitan, AnkiConnect and the fields
    </a>
  </SettingsItemGroup>
  <SettingsItemGroup
    title="AnkiConnect address"
    tooltip="Anki needs the AnkiConnect add-on, with this site's address ({origin}) in webCorsOriginList in the add-on's config."
  >
    <input
      id="anki-connect-url"
      aria-label="AnkiConnect address"
      autocomplete="off"
      class={inputClasses}
      bind:value={$ankiConnectUrl$}
    />
    <button class="{buttonClasses} mt-2" on:click={test}>Test connection</button>
    {#if testResult}<p class="mt-2 text-xs text-[color:var(--app-muted-fg)]">{testResult}</p>{/if}
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Sentence field"
    tooltip="Where the mined sentence is; read aloud by the AI voice or looked up in the audiobook. In visual novels, it picks the line whose screenshot and sound the card gets."
  >
    <input aria-label="Sentence field" class={inputClasses} bind:value={$ankiSentenceField$} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Audio field"
    tooltip="Gets the sentence or line audio. Left alone if already filled."
  >
    <input aria-label="Audio field" class={inputClasses} bind:value={$ankiAudioField$} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Picture field"
    tooltip="Gets the visual novel screenshot. Left alone if already filled."
  >
    <input aria-label="Picture field" class={inputClasses} bind:value={$ankiPictureField$} />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="anki-media">
  <SettingsItemGroup
    title="Book audio"
    tooltip="The sentence's lines from the book's imported audiobook (Listen → Audiobook), recorded in real time."
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ankiBookAudio$} />
  </SettingsItemGroup>
  {#if $activePlugins$.some((plugin) => plugin.ankiSentenceAudio)}
    <SettingsItemGroup
      title="Use ElevenLabs audio if no audiobook file present"
      tooltip="The sentence read by the AI voice (key and voice in Settings → AI). Each card uses ElevenLabs credits."
    >
      <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ankiBookAiFallback$} />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup
    title="Visual novel screenshot"
    tooltip="The game screen when the card was added."
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ankiVnScreenshot$} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Visual novel audio"
    tooltip="The game's sound (voice and music) since your last click or key press. Applies to games started after the change."
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ankiVnAudio$} />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="anki-known">
  <SettingsItemGroup
    title="Known words from Anki"
    tooltip="Reads the words of the deck's mature cards (interval of 21 days or more) at most once a day, kept in this browser only, to estimate how many of each book's words you know."
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={$ankiKnownWords$} />
  </SettingsItemGroup>
  {#if $ankiKnownWords$}
    <SettingsItemGroup title="Deck" tooltip="Its subdecks are included.">
      <input
        aria-label="Deck"
        autocomplete="off"
        class={inputClasses}
        list="anki-known-decks"
        bind:value={$ankiKnownDeck$}
      />
      <datalist id="anki-known-decks">
        {#each decks as deck}<option value={deck} />{/each}
      </datalist>
    </SettingsItemGroup>
    <SettingsItemGroup
      title="Word field"
      tooltip="The field holding the word (e.g. Expression or Word). HTML and furigana like 漢字[かんじ] are removed."
    >
      <input aria-label="Word field" class={inputClasses} bind:value={$ankiKnownField$} />
      <button class="{buttonClasses} mt-2" disabled={refreshing} on:click={refreshKnown}>
        {refreshing ? 'Reading…' : 'Refresh'}
      </button>
      <p class="mt-2 text-xs text-[color:var(--app-muted-fg)]">
        {#if refreshError}{refreshError}{:else if $knownWords$}{$knownWords$.words.length.toLocaleString(
            'en-US'
          )} known words, read {new Date($knownWords$.read).toLocaleString()}{:else}Not read yet{/if}
      </p>
    </SettingsItemGroup>
  {/if}
</SettingsSection>
