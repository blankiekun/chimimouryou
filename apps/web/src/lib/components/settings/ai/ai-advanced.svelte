<script lang="ts">
  import { acceptedParams } from '$lib/data/ai-client';
  import {
    aiConnectionCache$,
    aiFeatureState$,
    featureSetting,
    setFeature
  } from '$lib/data/ai-connections';
  import type { AiProvider } from '$lib/data/ai-providers';
  import {
    aiFeatureDefaults,
    type AiSamplers,
    type AiTextFeature,
    type ReasoningEffort
  } from '$lib/data/ai-settings';
  import { t$, type MessageKey } from '$lib/i18n';

  export let feature: AiTextFeature;
  export let title: string;
  export let provider: AiProvider | undefined;
  export let connectionId: string;
  export let model: string;

  type Name = keyof AiSamplers;

  interface Row {
    name: Name;
    label: MessageKey;
    note: MessageKey;
    kind: 'number' | 'reasoning' | 'switch' | 'seed';
    step?: number;
    min?: number;
    max?: number;
    /** Hidden on phones until "All settings" */
    minor?: boolean;
  }

  const allRows: Row[] = [
    {
      name: 'temperature',
      label: 'ai.temperature',
      note: 'ai.temperatureNote',
      kind: 'number',
      step: 0.1,
      min: 0,
      max: 2
    },
    {
      name: 'top_p',
      label: 'ai.topP',
      note: 'ai.topPNote',
      kind: 'number',
      step: 0.05,
      min: 0,
      max: 1,
      minor: true
    },
    {
      name: 'top_k',
      label: 'ai.topK',
      note: 'ai.topKNote',
      kind: 'number',
      step: 1,
      min: 0,
      minor: true
    },
    {
      name: 'min_p',
      label: 'ai.minP',
      note: 'ai.minPNote',
      kind: 'number',
      step: 0.01,
      min: 0,
      max: 1,
      minor: true
    },
    {
      name: 'frequency_penalty',
      label: 'ai.frequencyPenalty',
      note: 'ai.frequencyPenaltyNote',
      kind: 'number',
      step: 0.1,
      min: -2,
      max: 2,
      minor: true
    },
    {
      name: 'presence_penalty',
      label: 'ai.presencePenalty',
      note: 'ai.presencePenaltyNote',
      kind: 'number',
      step: 0.1,
      min: -2,
      max: 2,
      minor: true
    },
    {
      name: 'max_tokens',
      label: 'ai.maxTokens',
      note: 'ai.maxTokensNote',
      kind: 'number',
      step: 256,
      min: 16
    },
    {
      name: 'context',
      label: 'ai.contextSent',
      note: 'ai.contextSentNote',
      kind: 'number',
      step: 500,
      min: 0
    },
    { name: 'reasoning', label: 'ai.reasoning', note: 'ai.reasoningNote', kind: 'reasoning' },
    { name: 'stream', label: 'ai.stream', note: 'ai.streamNote', kind: 'switch' },
    { name: 'seed', label: 'ai.seed', note: 'ai.seedNote', kind: 'seed', step: 1, minor: true }
  ];
  const efforts: { id: ReasoningEffort; text: MessageKey }[] = [
    { id: 'off', text: 'ai.off' },
    { id: 'low', text: 'ai.low' },
    { id: 'medium', text: 'ai.medium' },
    { id: 'high', text: 'ai.high' }
  ];
  /** Not request parameters: always "sent" */
  const appSettings = new Set<Name>(['context', 'stream']);

  let showAll = false;

  // Recaps keep their own chunking; only Ask AI and the lorebook have Context sent.
  $: rows = allRows.filter((row) => row.name !== 'context' || feature !== 'recap');
  $: defaults = aiFeatureDefaults[feature] as Record<string, unknown>;
  $: params = $aiFeatureState$[feature].params as Record<string, unknown>;
  let accepted: string[] = [];

  $: {
    // The model list may arrive later with the model's own parameters.
    $aiConnectionCache$;
    accepted = provider ? acceptedParams(provider, connectionId, model) : [];
  }
  $: contextNote =
    feature === 'lore' ? 'ai.contextSentLoreNote' : ('ai.contextSentNote' as MessageKey);

  function sent(name: Name) {
    return appSettings.has(name) || accepted.includes(name);
  }

  function defaultText(name: Name) {
    const value = defaults[name];

    if (value === undefined || value === 'off') {
      return name === 'seed' ? $t$('ai.random') : $t$('ai.off');
    }

    if (typeof value === 'boolean') {
      return $t$(value ? 'ai.on' : 'ai.off');
    }

    return typeof value === 'number' ? value.toLocaleString() : String(value);
  }

  /** Saves only changes from the default; null turns a default off (not sent). */
  function set(name: Name, value: unknown) {
    const changes: Record<string, unknown> = { ...featureSetting(feature).params };

    if (value === defaults[name] || (value === null && defaults[name] === undefined)) {
      delete changes[name];
    } else {
      changes[name] = value;
    }

    setFeature(feature, { params: changes as AiSamplers });
  }

  function setNumber(name: Name, text: string) {
    const value = text.trim() === '' ? null : Number(text);

    if (value === null || Number.isFinite(value)) {
      set(name, value);
    }
  }
</script>

<div class="advanced">
  <header class="head">
    <h4>{$t$('ai.advancedTitle', { feature: title })}</h4>
    <button
      type="button"
      class="app-button app-button-quiet"
      on:click={() => setFeature(feature, { params: {} })}
      >{$t$('ai.resetFeature', { feature: title })}</button
    >
  </header>

  <table class="app-table samplers">
    <thead>
      <tr>
        <th scope="col">{$t$('ai.setting')}</th>
        <th scope="col">{$t$('ai.value')}</th>
        <th scope="col" class="col-default">{$t$('ai.defaultValue')}</th>
        <th scope="col" class="col-note">{$t$('ai.note')}</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.name)}
        <tr class:minor={row.minor && !showAll}>
          <th scope="row">
            <label for="ai-{feature}-{row.name}">{$t$(row.label)}</label>
            <span class="phone-default"
              >{$t$('ai.defaultIs', { value: defaultText(row.name) })}</span
            >
          </th>
          <td>
            {#if row.kind === 'reasoning'}
              <div class="app-segmented" role="radiogroup" aria-label={$t$(row.label)}>
                {#each efforts as effort}
                  <button
                    type="button"
                    role="radio"
                    class="app-segment"
                    class:app-segment-selected={(params.reasoning ?? 'off') === effort.id}
                    aria-checked={(params.reasoning ?? 'off') === effort.id}
                    on:click={() => set('reasoning', effort.id)}>{$t$(effort.text)}</button
                  >
                {/each}
              </div>
            {:else if row.kind === 'switch'}
              <button
                id="ai-{feature}-{row.name}"
                type="button"
                role="switch"
                class="app-switch"
                aria-checked={!!params.stream}
                on:click={() => set('stream', !params.stream)}
              >
                <span class="app-switch-thumb" />
              </button>
            {:else}
              <input
                id="ai-{feature}-{row.name}"
                class="app-input value-input"
                type="number"
                inputmode="decimal"
                step={row.step}
                min={row.min}
                max={row.max}
                placeholder={row.kind === 'seed' ? $t$('ai.random') : '—'}
                value={params[row.name] ?? ''}
                on:change={(event) => setNumber(row.name, event.currentTarget.value)}
              />
            {/if}
          </td>
          <td class="col-default num">{defaultText(row.name)}</td>
          <td class="col-note">
            {#if !sent(row.name)}
              <span class="app-tag app-tag-muted">{$t$('ai.notSent')}</span>
              {$t$('ai.notTaken')}
            {:else}
              {$t$(row.name === 'context' ? contextNote : row.note)}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="phone-actions">
    <button type="button" class="app-button app-button-quiet" on:click={() => (showAll = !showAll)}
      >{$t$(showAll ? 'ai.fewerSettings' : 'ai.allSettings', { count: rows.length })}</button
    >
  </p>
</div>

<style>
  .advanced {
    padding: 0.75rem 1rem 0.5rem;
    margin: 0.25rem 0 0.75rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 1rem;
  }

  h4 {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .head button {
    min-height: 2rem;
  }

  .samplers {
    margin-top: 0.75rem;
  }

  .samplers th[scope='row'] {
    width: 11rem;
    padding: 0.5rem 0.75rem 0.5rem 0;
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 400;
  }

  .samplers td {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .samplers .app-segmented {
    flex-wrap: nowrap;
  }

  .samplers .app-segment {
    padding: 0.25rem 0.6rem;
  }

  .value-input {
    width: 6.5rem;
    font-variant-numeric: tabular-nums;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .col-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .phone-default,
  .phone-actions {
    display: none;
  }

  @media (max-width: 640px) {
    .samplers thead,
    .col-default,
    .col-note {
      display: none;
    }

    .samplers tr.minor {
      display: none;
    }

    .phone-default {
      display: block;
      color: var(--app-muted-fg);
      font-size: var(--type-small);
    }

    .samplers td {
      text-align: right;
    }

    .phone-actions {
      display: block;
      padding: 0.5rem 0;
    }
  }
</style>
