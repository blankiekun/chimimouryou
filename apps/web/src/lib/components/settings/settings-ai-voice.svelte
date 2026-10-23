<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { deviceVoiceName$, ttsPlaybackRate$ } from '$lib/data/ai-settings';
  import { deviceUtterance, deviceVoices, pickDeviceVoice } from '$lib/data/tts';
  import { t$ } from '$lib/i18n';
  import { onDestroy, onMount } from 'svelte';

  const sample = '吾輩は猫である。名前はまだ無い。';

  let voices: SpeechSynthesisVoice[] = [];
  let loaded = false;

  onMount(async () => {
    voices = await deviceVoices();
    loaded = true;
  });

  onDestroy(() => {
    if (voices.length) {
      speechSynthesis.cancel();
    }
  });

  function playSample() {
    speechSynthesis.cancel();
    speechSynthesis.speak(
      deviceUtterance(sample, pickDeviceVoice(voices, $deviceVoiceName$), $ttsPlaybackRate$)
    );
  }
</script>

<!-- AI voice without an ElevenLabs key (tts.ts): this browser's Web Speech voices. -->
<SettingsSection id="ai-voice" keywords="web speech tts device voice">
  <SettingsItemGroup title={$t$('ai.deviceVoice')} tooltip={$t$('ai.deviceVoiceHint')}>
    {#if loaded && !voices.length}
      <span class="voice-none">{$t$('ai.deviceVoiceNone')}</span>
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
</SettingsSection>

<style>
  .voice-field {
    display: flex;
    min-width: 0;
    gap: 0.5rem;
  }

  .voice-field select {
    min-width: 0;
    max-width: 16rem;
  }

  .voice-none {
    color: var(--app-muted-fg);
  }
</style>
