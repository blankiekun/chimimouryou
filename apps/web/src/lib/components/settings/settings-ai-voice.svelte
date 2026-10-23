<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { loadModels } from '$lib/data/ai-client';
  import {
    aiConnectionCache$,
    aiFeatureState$,
    deviceVoice,
    setFeature
  } from '$lib/data/ai-connections';
  import {
    aiConnections$,
    deviceVoiceName$,
    ttsPlaybackRate$,
    ttsVoiceId$
  } from '$lib/data/ai-settings';
  import {
    deviceUtterance,
    deviceVoices,
    elevenLabsVoice,
    pickDeviceVoice,
    synthesizeSpeech
  } from '$lib/data/tts';
  import { t$ } from '$lib/i18n';
  import { onDestroy, onMount } from 'svelte';

  const sample = '吾輩は猫である。名前はまだ無い。';

  let voices: SpeechSynthesisVoice[] = [];
  let loaded = false;
  let sampleAudio: HTMLAudioElement | undefined;
  let playing = false;
  let sampleError = '';
  let loadingVoices = false;
  /** Connections whose voices were asked for once on this page, so a failure isn't retried in a loop */
  let askedVoices = new Set<string>();

  $: resolved = $aiFeatureState$.voice;
  $: connection = resolved.connection;
  $: voiceConnections = $aiConnections$.filter((c) => !c.deleted && c.kind === 'voice');
  $: eleven = $aiFeatureState$ && elevenLabsVoice();
  $: models = cache?.models?.length
    ? cache.models.map((model) => model.id)
    : (resolved.provider?.models ?? []);
  /** A pasted voice ID (e.g. from the Voice Library) instead of one from the list */
  let typingVoiceId = false;
  $: cache = connection ? $aiConnectionCache$[connection.id] : undefined;
  // Japanese voices first; the list is the account's library.
  $: voiceList = [...(cache?.voiceList ?? [])].sort(
    (a, b) => Number(b.lang === 'ja') - Number(a.lang === 'ja')
  );
  $: if (connection && eleven && !cache?.voiceList && !askedVoices.has(connection.id)) {
    loadVoices();
  }

  onMount(async () => {
    voices = await deviceVoices();
    loaded = true;
  });

  onDestroy(stopSample);

  async function loadVoices() {
    if (!connection) {
      return;
    }

    askedVoices = new Set([...askedVoices, connection.id]);
    loadingVoices = true;
    try {
      await loadModels(connection, eleven?.key);
    } catch {
      // The Voice ID field stays usable; the connection's test shows why.
    } finally {
      loadingVoices = false;
    }
  }

  function stopSample() {
    if (voices.length) {
      speechSynthesis.cancel();
    }
    sampleAudio?.pause();
    if (sampleAudio) {
      URL.revokeObjectURL(sampleAudio.src);
    }
    sampleAudio = undefined;
  }

  async function playSample() {
    stopSample();
    sampleError = '';

    if (!eleven) {
      speechSynthesis.speak(
        deviceUtterance(sample, pickDeviceVoice(voices, $deviceVoiceName$), $ttsPlaybackRate$)
      );
      return;
    }

    playing = true;
    try {
      const { audio } = await synthesizeSpeech(sample);

      sampleAudio = new Audio(URL.createObjectURL(audio));
      sampleAudio.playbackRate = $ttsPlaybackRate$;
      await sampleAudio.play();
    } catch (error) {
      sampleError = error instanceof Error ? error.message : String(error);
    } finally {
      playing = false;
    }
  }

  function voiceLabel(voice: { name: string; lang?: string }) {
    return voice.lang ? `${voice.name} · ${voice.lang}` : voice.name;
  }
</script>

<!-- AI voice (tts.ts): this device's Web Speech voices by default, ElevenLabs once a voice connection has a key. -->
<SettingsSection id="ai-read-aloud" keywords="web speech tts device voice elevenlabs">
  <SettingsItemGroup title={$t$('ai.connection')} tooltip={$t$('ai.voiceConnectionHint')}>
    <select
      id="voice-connection"
      class="app-input"
      aria-label={$t$('ai.connectionFor', { feature: $t$('ai.featureVoice') })}
      value={connection?.id ?? deviceVoice}
      on:change={(event) =>
        setFeature('voice', { connection: event.currentTarget.value, model: '' })}
    >
      <option value={deviceVoice}>{$t$('ai.deviceVoices')}</option>
      {#each voiceConnections as c (c.id)}
        <option value={c.id}>{c.name}</option>
      {/each}
    </select>
  </SettingsItemGroup>

  {#if connection && !eleven}
    <SettingsItemGroup title={$t$('ai.deviceVoice')} tooltip={$t$('ai.voiceNoKeyHint')}>
      <span class="muted">{$t$('ai.needsKey')}</span>
    </SettingsItemGroup>
  {:else if connection}
    <SettingsItemGroup title={$t$('ai.model')} tooltip={$t$('ai.voiceModelHint')}>
      <select
        id="voice-model"
        class="app-input"
        aria-label={$t$('ai.modelFor', { feature: $t$('ai.featureVoice') })}
        value={resolved.model}
        on:change={(event) =>
          setFeature('voice', {
            connection: connection?.id ?? '',
            model: event.currentTarget.value
          })}
      >
        {#each models.includes(resolved.model) ? models : [resolved.model, ...models] as model}
          <option value={model}>{model}</option>
        {/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('ai.deviceVoice')} tooltip={$t$('ai.elevenLabsVoiceHint')}>
      <span class="voice-field">
        {#if voiceList.length && !typingVoiceId}
          <select
            id="tts-voice"
            class="app-input"
            aria-label={$t$('ai.deviceVoice')}
            value={$ttsVoiceId$}
            on:change={(event) => {
              if (event.currentTarget.value === '\u0000other') {
                typingVoiceId = true;
              } else {
                $ttsVoiceId$ = event.currentTarget.value;
              }
            }}
          >
            {#if !voiceList.some((v) => v.id === $ttsVoiceId$)}
              <option value={$ttsVoiceId$}>{$ttsVoiceId$ || $t$('ai.chooseVoice')}</option>
            {/if}
            {#each voiceList as v (v.id)}
              <option value={v.id}>{voiceLabel(v)}</option>
            {/each}
            <option value={'\u0000other'}>{$t$('ai.otherVoiceId')}</option>
          </select>
        {:else}
          <input
            id="tts-voice"
            autocomplete="off"
            placeholder={$t$(loadingVoices ? 'ai.loadingVoices' : 'ai.voiceIdPlaceholder', {
              id: '21m00Tcm4TlvDq8ikWAM'
            })}
            aria-label={$t$('ai.voiceId')}
            class="app-input"
            bind:value={$ttsVoiceId$}
          />
        {/if}
        <button
          type="button"
          class="app-button"
          disabled={playing || !$ttsVoiceId$}
          on:click={playSample}>{$t$('ai.playSample')}</button
        >
      </span>
    </SettingsItemGroup>
  {:else}
    <SettingsItemGroup title={$t$('ai.deviceVoice')} tooltip={$t$('ai.deviceVoiceHint')}>
      {#if loaded && !voices.length}
        <span class="muted">{$t$('ai.deviceVoiceNone')}</span>
      {:else}
        <span class="voice-field">
          <select
            id="device-voice"
            class="app-input"
            aria-label={$t$('ai.deviceVoice')}
            disabled={!loaded}
            bind:value={$deviceVoiceName$}
          >
            <option value="">{$t$('ai.deviceVoiceAuto')}</option>
            {#each voices as voice (voice.voiceURI)}
              <option value={voice.name}>{voice.name} · {voice.lang}</option>
            {/each}
          </select>
          <button type="button" class="app-button" disabled={!loaded} on:click={playSample}
            >{$t$('ai.playSample')}</button
          >
        </span>
      {/if}
    </SettingsItemGroup>
  {/if}
  {#if sampleError}
    <p class="sample-error" role="alert">{sampleError}</p>
  {/if}

  <SettingsItemGroup title={$t$('ai.voiceSpeed')} tooltip={$t$('ai.voiceSpeedHint')}>
    <select
      id="tts-speed"
      class="app-input"
      aria-label={$t$('ai.voiceSpeed')}
      bind:value={$ttsPlaybackRate$}
    >
      {#each [0.75, 0.9, 1, 1.1, 1.25, 1.5] as rate}
        <option value={rate}>{rate}×</option>
      {/each}
    </select>
  </SettingsItemGroup>

  {#if !eleven}
    <aside class="note" data-settings-item>
      <h3>{$t$('ai.withoutVoiceKey')}</h3>
      <p>{$t$('ai.withoutVoiceKeyText')}</p>
    </aside>
  {/if}
</SettingsSection>

<style>
  .voice-field {
    display: flex;
    min-width: 0;
    gap: 0.5rem;
  }

  .voice-field select,
  .voice-field input {
    min-width: 0;
    max-width: 16rem;
  }

  .muted {
    color: var(--app-muted-fg);
  }

  .sample-error {
    padding: 0.5rem 0;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .note {
    margin: 1rem 0;
    padding: 0.85rem 1rem;
    border-radius: 2px;
    background: var(--surface-color);
  }

  .note h3 {
    font-size: var(--type-small);
    font-weight: 700;
  }

  .note p {
    margin-top: 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.55;
  }
</style>
