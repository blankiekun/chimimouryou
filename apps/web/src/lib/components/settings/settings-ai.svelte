<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import AiLanguageToggle from '$lib/components/ai-language-toggle.svelte';
  import { inputClasses } from '$lib/css-classes';
  import { faArrowDown, faArrowUp, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import {
    askAiDefaultPreset$,
    askAiPresets$,
    askAiReaderNote$,
    defaultAskAiPresets,
    defaultOpenRouterModel,
    lorebookAutoInterval$,
    openRouterApiKey$,
    openRouterModel$,
    openRouterRecapModel$,
    defaultElevenLabsModel,
    elevenLabsApiKey$,
    elevenLabsModel$,
    ttsPlaybackRate$,
    ttsVoiceId$
  } from '$lib/data/ai-settings';
  import { listOpenRouterModels, type OpenRouterModel } from '$lib/data/ask-ai';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  const link = (href: string, text: string) =>
    `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;

  let models: OpenRouterModel[] = [];
  let modelsError = '';

  $: knownModel = !models.length || models.some((model) => model.id === $openRouterModel$);

  function updatePreset(index: number, changes: Partial<{ label: string; prompt: string }>) {
    $askAiPresets$ = $askAiPresets$.map((preset, i) =>
      i === index ? { ...preset, ...changes } : preset
    );
  }

  function movePreset(index: number, offset: number) {
    const presets = [...$askAiPresets$];
    const [preset] = presets.splice(index, 1);

    presets.splice(index + offset, 0, preset);
    $askAiPresets$ = presets;
  }

  function addPreset() {
    $askAiPresets$ = [
      ...$askAiPresets$,
      { id: `custom-${Date.now().toString(36)}`, label: 'New', prompt: '' }
    ];
  }

  onMount(() => {
    listOpenRouterModels()
      .then((result) => {
        models = result;
      })
      .catch((error) => {
        modelsError = error.message;
      });
  });
</script>

<SettingsSection id="ai-guide" keywords="api key openrouter elevenlabs voice">
  <SettingsItemGroup title={$t$('ai.guideOpenRouter')} tooltip={$t$('ai.guideOpenRouterHint')}>
    <!-- Our own strings with links as params, so translations can put them anywhere. -->
    <ol class="guide-steps">
      <li>{@html $t$('ai.guideAccount', { link: link('https://openrouter.ai', 'openrouter.ai') })}</li>
      <li>
        {@html $t$('ai.guideCredits', {
          link: link('https://openrouter.ai/settings/credits', 'Settings → Credits')
        })}
      </li>
      <li>
        {@html $t$('ai.guideOpenRouterKey', {
          link: link('https://openrouter.ai/settings/keys', 'Settings → API Keys')
        })}
      </li>
      <li>
        {@html $t$('ai.guideOpenRouterPaste', {
          prefix: '<code>sk-or-</code>',
          field: `<a href="#ai-ask">${$t$('ai.openRouterKey')}</a>`
        })}
      </li>
      <li>{$t$('ai.guideModels')}</li>
    </ol>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.guideElevenLabs')} tooltip={$t$('ai.guideElevenLabsHint')}>
    <ol class="guide-steps">
      <li>{@html $t$('ai.guideAccount', { link: link('https://elevenlabs.io', 'elevenlabs.io') })}</li>
      <li>{$t$('ai.guideElevenLabsKey')}</li>
      <li>
        {@html $t$('ai.guideElevenLabsPaste', {
          prefix: '<code>sk_</code>',
          field: `<a href="#ai-read-aloud">${$t$('ai.elevenLabsKey')}</a>`
        })}
      </li>
      <li>{$t$('ai.guideVoice', { field: $t$('ai.voiceId') })}</li>
      <li>{$t$('ai.guideListen')}</li>
    </ol>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.keysWhere')} tooltip={$t$('ai.keysWhereHint')} wide />
</SettingsSection>

<SettingsSection id="ai-ask">
  <SettingsItemGroup title={$t$('ai.openRouterKey')} tooltip={$t$('ai.openRouterKeyHint')}>
    <input
      id="openrouter-key"
      type="password"
      autocomplete="off"
      placeholder="sk-or-..."
      aria-label={$t$('ai.openRouterKey')}
      class={inputClasses}
      bind:value={$openRouterApiKey$}
    />
    <a class="mt-2 inline-block text-xs underline" href="#ai-guide">{$t$('ai.howToGetKey')}</a>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.language')} tooltip={$t$('ai.languageHint')}>
    <AiLanguageToggle />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.model')} tooltip={$t$('ai.modelHint')}>
    <input
      id="openrouter-model"
      aria-label={$t$('ai.model')}
      list="openrouter-models"
      autocomplete="off"
      placeholder={defaultOpenRouterModel}
      class={inputClasses}
      bind:value={$openRouterModel$}
      on:change={() => {
        if (!$openRouterModel$.trim()) {
          openRouterModel$.next(defaultOpenRouterModel);
        }
      }}
    />
    <datalist id="openrouter-models">
      {#each models as model (model.id)}
        <option value={model.id}>{model.name}</option>
      {/each}
    </datalist>
    <p class="mt-2 text-xs text-[color:var(--app-muted-fg)]">
      {#if modelsError}
        {modelsError}
      {:else if !knownModel}
        {$t$('ai.unknownModel')}
      {:else if models.length}
        {$t$('ai.modelSearch', { count: models.length })}
      {:else}
        {$t$('ai.modelSearchAny')}
      {/if}
    </p>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.aboutYou')} tooltip={$t$('ai.aboutYouHint')} wide>
    <textarea
      id="ask-ai-reader-note"
      class="{inputClasses} min-h-[2.5rem] w-full"
      rows="2"
      aria-label={$t$('ai.aboutYou')}
      placeholder={$t$('ai.optional')}
      bind:value={$askAiReaderNote$}
    />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="ai-presets" wide>
  <SettingsItemGroup title={$t$('ai.presets')} tooltip={$t$('ai.presetsHint')} wide>
    <div class="flex flex-col gap-3">
      {#each $askAiPresets$ as preset, index (preset.id)}
        <div class="preset-row">
          <input
            class={inputClasses}
            aria-label={$t$('ai.presetLabel')}
            value={preset.label}
            on:change={(event) => updatePreset(index, { label: event.currentTarget.value })}
          />
          <textarea
            class="{inputClasses} min-h-[2.5rem]"
            rows="2"
            aria-label={$t$('ai.prompt')}
            value={preset.prompt}
            on:change={(event) => updatePreset(index, { prompt: event.currentTarget.value })}
          />
          <span class="flex items-center gap-1">
            <button
              class="p-1.5 disabled:opacity-30"
              title={$t$('ai.moveUp')}
              disabled={index === 0}
              on:click={() => movePreset(index, -1)}><Fa icon={faArrowUp} /></button
            >
            <button
              class="p-1.5 disabled:opacity-30"
              title={$t$('ai.moveDown')}
              disabled={index === $askAiPresets$.length - 1}
              on:click={() => movePreset(index, 1)}><Fa icon={faArrowDown} /></button
            >
            <button
              class="p-1.5"
              title={$t$('ai.delete')}
              on:click={() => ($askAiPresets$ = $askAiPresets$.filter((_, i) => i !== index))}
              ><Fa icon={faTrash} /></button
            >
          </span>
        </div>
      {/each}
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <button class="flex items-center gap-1.5 font-semibold" on:click={addPreset}>
          <Fa icon={faPlus} />
          {$t$('ai.addPreset')}
        </button>
        <button
          class="font-semibold text-[color:var(--app-muted-fg)] underline"
          on:click={() => ($askAiPresets$ = defaultAskAiPresets)}
        >
          {$t$('ai.resetPresets')}
        </button>
        <label class="ml-auto flex items-center gap-2">
          {$t$('ai.panelOpens')}
          <select bind:value={$askAiDefaultPreset$}>
            <option value="">{$t$('ai.waitForChoice')}</option>
            {#each $askAiPresets$ as preset (preset.id)}
              <option value={preset.id}>{$t$('ai.runPreset', { label: preset.label })}</option>
            {/each}
          </select>
        </label>
      </div>
    </div>
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="ai-read-aloud">
  <SettingsItemGroup title={$t$('ai.elevenLabsKey')} tooltip={$t$('ai.elevenLabsKeyHint')}>
    <input
      id="tts-key"
      type="password"
      autocomplete="off"
      placeholder="sk_..."
      aria-label={$t$('ai.elevenLabsKey')}
      class={inputClasses}
      bind:value={$elevenLabsApiKey$}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.elevenLabsModel')} tooltip={$t$('ai.elevenLabsModelHint')}>
    <input
      id="tts-model"
      list="elevenlabs-models"
      autocomplete="off"
      aria-label={$t$('ai.elevenLabsModel')}
      placeholder={defaultElevenLabsModel}
      class={inputClasses}
      bind:value={$elevenLabsModel$}
    />
    <datalist id="elevenlabs-models">
      <option value="eleven_v4" />
      <option value="eleven_v4_turbo" />
      <option value="eleven_multilingual_v2" />
    </datalist>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.voiceSpeed')} tooltip={$t$('ai.voiceSpeedHint')}>
    <select id="tts-speed" aria-label={$t$('ai.voiceSpeed')} bind:value={$ttsPlaybackRate$}>
      {#each [0.75, 0.9, 1, 1.1, 1.25, 1.5] as rate}
        <option value={rate}>{rate}×</option>
      {/each}
    </select>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.voiceId')} tooltip={$t$('ai.voiceIdHint')}>
    <input
      id="tts-voice"
      autocomplete="off"
      placeholder={$t$('ai.voiceIdPlaceholder', { id: '21m00Tcm4TlvDq8ikWAM' })}
      aria-label={$t$('ai.voiceId')}
      class={inputClasses}
      bind:value={$ttsVoiceId$}
    />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="ai-recap">
  <SettingsItemGroup title={$t$('ai.recapModel')} tooltip={$t$('ai.recapModelHint')}>
    <input
      id="recap-model"
      list="openrouter-models"
      autocomplete="off"
      aria-label={$t$('ai.recapModel')}
      placeholder={$t$('ai.recapModelPlaceholder', { model: $openRouterModel$ })}
      class={inputClasses}
      bind:value={$openRouterRecapModel$}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('ai.lorebookAuto')} tooltip={$t$('ai.lorebookAutoHint')}>
    <input
      id="lorebook-interval"
      type="number"
      min="0"
      step="5000"
      aria-label={$t$('ai.lorebookInterval')}
      placeholder={$t$('ai.lorebookOff')}
      class={inputClasses}
      bind:value={$lorebookAutoInterval$}
    />
  </SettingsItemGroup>
</SettingsSection>

<style>
  .guide-steps {
    display: grid;
    gap: 0.35rem;
    padding-left: 1.2rem;
    font-size: 0.88rem;
    list-style: decimal;
  }

  .guide-steps :global(a) {
    text-decoration: underline;
  }

  .preset-row {
    display: grid;
    grid-template-columns: 8rem minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
  }

  @media (max-width: 640px) {
    .preset-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .preset-row textarea {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
