<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import SettingsAiVoice from '$lib/components/ai/settings-ai-voice.svelte';
  import SettingsAiPrompts from '$lib/components/ai/settings-ai-prompts.svelte';
  import AiConnections from '$lib/components/ai/ai-connections.svelte';
  import AiFeatures from '$lib/components/ai/ai-features.svelte';
  import AiGetStarted from '$lib/components/ai/ai-get-started.svelte';
  import { testConnection } from '$lib/data/ai/ai-client';
  import { aiFeatureState$, connectProvider } from '$lib/data/ai/ai-connections';
  import {
    aiConnections$,
    askAiDefaultPreset$,
    askAiPresets$,
    askAiReaderNote$,
    defaultAskAiPresets,
    lorebookAutoInterval$
  } from '$lib/data/ai/ai-settings';
  import { exchangeOpenRouterCode, openRouterCallback } from '$lib/data/ai/openrouter-oauth';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  const link = (href: string, text: string) =>
    `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;

  $: connectionCount = $aiConnections$.filter((c) => !c.deleted).length;
  // No text connection (nor the previous release's OpenRouter key): show Get started.
  $: firstRun = !$aiFeatureState$.ask.connection;

  let signingIn = false;
  let signInError = '';

  onMount(() => {
    const callback = openRouterCallback(new URL(window.location.href));

    if (!callback) {
      return;
    }

    // The code leaves the address bar before anything else runs. This component mounts
    // before the settings page, whose onMount then opens the section named here;
    // SvelteKit's replaceState isn't ready yet, so this is the browser's own.
    const clean = new URL(callback.cleanUrl);

    clean.searchParams.set('section', 'ai');
    clean.hash = 'ai-connections';
    window.history.replaceState(window.history.state, '', clean);

    signingIn = true;
    exchangeOpenRouterCode(callback.code, callback.state)
      .then((key) => testConnection(connectProvider('openrouter', key)))
      .catch((error) => (signInError = error instanceof Error ? error.message : String(error)))
      .finally(() => (signingIn = false));
  });

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
</script>

<SettingsSection
  id="ai-connections"
  wide
  count={connectionCount || undefined}
  title={firstRun ? $t$('ai.getStarted') : ''}
>
  <div data-settings-item data-settings-search="{$t$('ai.connection')} api key openrouter gemini">
    {#if firstRun}
      <AiGetStarted {signingIn} {signInError} />
    {/if}
    <AiConnections />
  </div>
</SettingsSection>

<SettingsSection id="ai-features" wide>
  <div data-settings-item data-settings-search="{$t$('ai.feature')} {$t$('ai.model')}">
    <AiFeatures />
  </div>
  <SettingsItemGroup title={$t$('ai.lorebookAuto')} tooltip={$t$('ai.lorebookAutoHint')}>
    <input
      id="lorebook-interval"
      type="number"
      min="0"
      step="5000"
      aria-label={$t$('ai.lorebookInterval')}
      placeholder={$t$('ai.lorebookOff')}
      class="app-input"
      bind:value={$lorebookAutoInterval$}
    />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="ai-presets" wide>
  <SettingsItemGroup title={$t$('ai.aboutYou')} wide>
    <textarea
      id="ask-ai-reader-note"
      class="app-input w-full"
      rows="2"
      aria-label={$t$('ai.aboutYou')}
      placeholder={$t$('ai.optional')}
      bind:value={$askAiReaderNote$}
    />
  </SettingsItemGroup>
  <div data-settings-item data-settings-search={$t$('ai.presets')}>
    <table class="app-table presets">
      <thead>
        <tr>
          <th scope="col">{$t$('ai.presetLabel')}</th>
          <th scope="col">{$t$('ai.prompt')}</th>
          <th scope="col"><span class="sr-only">{$t$('ai.presetActions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each $askAiPresets$ as preset, index (preset.id)}
          <tr>
            <td class="preset-label">
              <input
                class="preset-input"
                aria-label={$t$('ai.presetLabel')}
                value={preset.label}
                on:change={(event) => updatePreset(index, { label: event.currentTarget.value })}
              />
            </td>
            <td>
              <textarea
                class="preset-input"
                rows="2"
                aria-label={$t$('ai.prompt')}
                value={preset.prompt}
                on:change={(event) => updatePreset(index, { prompt: event.currentTarget.value })}
              />
            </td>
            <td class="preset-actions">
              <button
                type="button"
                disabled={index === 0}
                title={$t$('ai.moveUp')}
                on:click={() => movePreset(index, -1)}>{$t$('ai.up')}</button
              >
              <button
                type="button"
                disabled={index === $askAiPresets$.length - 1}
                title={$t$('ai.moveDown')}
                on:click={() => movePreset(index, 1)}>{$t$('ai.down')}</button
              >
              <button
                type="button"
                on:click={() => ($askAiPresets$ = $askAiPresets$.filter((_, i) => i !== index))}
                >{$t$('ai.delete')}</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="preset-buttons">
      <button type="button" class="app-button" on:click={addPreset}>{$t$('ai.addPreset')}</button>
      <button
        type="button"
        class="app-button app-button-quiet"
        on:click={() => ($askAiPresets$ = defaultAskAiPresets)}
      >
        {$t$('ai.resetPresets')}
      </button>
    </p>
  </div>
  <SettingsItemGroup title={$t$('ai.panelOpens')}>
    <select class="app-input" aria-label={$t$('ai.panelOpens')} bind:value={$askAiDefaultPreset$}>
      <option value="">{$t$('ai.waitForChoice')}</option>
      {#each $askAiPresets$ as preset (preset.id)}
        <option value={preset.id}>{$t$('ai.runPreset', { label: preset.label })}</option>
      {/each}
    </select>
  </SettingsItemGroup>
</SettingsSection>

<SettingsAiVoice />

<SettingsSection id="ai-guide" keywords="api key openrouter elevenlabs voice">
  <div class="guide-columns">
    <section
      class="guide"
      data-settings-item
      data-settings-search="{$t$('ai.guideOpenRouter')} {$t$('ai.guideOpenRouterHint')}"
    >
      <h3>{$t$('ai.guideOpenRouter')}</h3>
      <p>{$t$('ai.guideOpenRouterHint')}</p>
      <!-- Our own strings with links as params, so translations can put them anywhere. -->
      <ol class="guide-steps">
        <li>
          {@html $t$('ai.guideAccount', { link: link('https://openrouter.ai', 'openrouter.ai') })}
        </li>
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
            field: `<a href="#ai-connections">${$t$('settings.section.ai-connections')}</a>`
          })}
        </li>
        <li>{$t$('ai.guideModels')}</li>
      </ol>
    </section>
    <section
      class="guide"
      data-settings-item
      data-settings-search="{$t$('ai.guideElevenLabs')} {$t$('ai.guideElevenLabsHint')}"
    >
      <h3>{$t$('ai.guideElevenLabs')}</h3>
      <p>{$t$('ai.guideElevenLabsHint')}</p>
      <ol class="guide-steps">
        <li>
          {@html $t$('ai.guideAccount', { link: link('https://elevenlabs.io', 'elevenlabs.io') })}
        </li>
        <li>{$t$('ai.guideElevenLabsKey')}</li>
        <li>
          {@html $t$('ai.guideElevenLabsPaste', {
            prefix: '<code>sk_</code>',
            field: `<a href="#ai-connections">${$t$('settings.section.ai-connections')}</a>`
          })}
        </li>
        <li>{$t$('ai.guideVoice', { field: $t$('ai.voiceId') })}</li>
        <li>{$t$('ai.guideListen')}</li>
      </ol>
    </section>
  </div>
</SettingsSection>

<SettingsAiPrompts />

<style>
  .guide-columns {
    display: grid;
    gap: 1.5rem 2.5rem;
    padding: 1rem 0 1.25rem;
  }

  @media (min-width: 768px) {
    .guide-columns {
      grid-template-columns: 1fr 1fr;
    }
  }

  .guide h3 {
    font-size: var(--type-body);
    font-weight: 400;
  }

  .guide > p {
    margin-top: 0.35rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.55;
  }

  .guide-steps {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.85rem;
    counter-reset: step;
    line-height: 1.55;
  }

  .guide-steps li {
    position: relative;
    padding-left: 1.9rem;
    counter-increment: step;
  }

  /* Step numbers in a square spot-colour frame */
  .guide-steps li::before {
    content: counter(step);
    position: absolute;
    top: 0.1rem;
    left: 0;
    display: inline-flex;
    width: 1.25rem;
    height: 1.25rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--accent-color);
    border-radius: 2px;
    color: var(--accent-strong-color);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }

  .guide-steps :global(a) {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .guide-steps :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
  }

  .presets {
    margin-top: 1rem;
  }

  .presets td {
    vertical-align: top;
  }

  .preset-label {
    width: 7.5rem;
  }

  .preset-input {
    display: block;
    width: 100%;
    min-height: 2.25rem;
    padding: 0.35rem 0.4rem;
    margin-left: -0.4rem;
    border: 1px solid transparent !important;
    border-radius: 2px;
    background: transparent;
    font-size: var(--type-small);
    resize: vertical;
  }

  .preset-label .preset-input {
    font-size: var(--type-body);
  }

  .preset-input:hover {
    border-color: var(--border-color) !important;
  }

  .preset-input:focus {
    border-color: var(--app-focus-ring) !important;
  }

  .preset-actions {
    width: 1%;
    white-space: nowrap;
  }

  .preset-actions button {
    min-height: 2.25rem;
    padding: 0 0.35rem;
    color: var(--accent-strong-color);
    font-size: var(--type-label);
  }

  .preset-actions button:disabled {
    color: var(--app-muted-fg);
    opacity: 0.5;
  }

  .preset-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.25rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  @media (max-width: 640px) {
    .presets thead {
      display: none;
    }

    .presets tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .presets td:nth-child(2) {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .preset-label {
      width: auto;
    }
  }
</style>
