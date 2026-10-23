<script lang="ts">
  import { aiFeatureState$, setFeature } from '$lib/data/ai-connections';
  import {
    aiConnections$,
    aiFeatures$,
    modelShortName,
    type AiFeature,
    type AiTextFeature
  } from '$lib/data/ai-settings';
  import { t$, type MessageKey } from '$lib/i18n';
  import AiAdvanced from './ai-advanced.svelte';
  import AiModelPicker from './ai-model-picker.svelte';

  interface FeatureRow {
    id: AiFeature;
    label: MessageKey;
    hint: MessageKey;
    /** Option that uses the feature above */
    inherit?: MessageKey;
  }

  const rows: FeatureRow[] = [
    { id: 'ask', label: 'ai.featureAsk', hint: 'ai.featureAskHint' },
    { id: 'recap', label: 'ai.featureRecap', hint: 'ai.featureRecapHint', inherit: 'ai.sameAsAsk' },
    { id: 'lore', label: 'ai.featureLore', hint: 'ai.featureLoreHint', inherit: 'ai.sameAsRecap' },
    { id: 'voice', label: 'ai.featureVoice', hint: 'ai.featureVoiceHint' }
  ];

  let advanced: AiFeature | '' = '';

  $: resolved = $aiFeatureState$;
  $: live = $aiConnections$.filter((c) => !c.deleted);
  $: choices = {
    text: live.filter((c) => c.kind === 'text'),
    voice: live.filter((c) => c.kind === 'voice')
  };
  $: selected = Object.fromEntries(
    rows.map(({ id }) => [
      id,
      $aiFeatures$[id]?.connection === 'inherit' ? 'inherit' : (resolved[id].connection?.id ?? '')
    ])
  );

  /** Advanced is only shown for the text features */
  const textFeature = (feature: AiFeature) => feature as AiTextFeature;
</script>

<table class="app-table features">
  <thead>
    <tr>
      <th scope="col">{$t$('ai.feature')}</th>
      <th scope="col">{$t$('ai.connection')}</th>
      <th scope="col">{$t$('ai.model')}</th>
      <th scope="col"><span class="sr-only">{$t$('ai.advanced')}</span></th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.id)}
      {@const r = resolved[row.id]}
      {@const options = choices[row.id === 'voice' ? 'voice' : 'text']}
      <tr class:open={advanced === row.id}>
        <th scope="row">
          <span class="name">{$t$(row.label)}</span>
          <span class="sub">{$t$(row.hint)}</span>
        </th>
        {#if !r.connection}
          <td colspan="3" class="sub needs">
            {$t$(row.id === 'voice' ? 'ai.needsVoiceConnection' : 'ai.needsConnection')}
          </td>
        {:else}
          <td class="col-connection">
            <select
              class="app-input w-full"
              aria-label={$t$('ai.connectionFor', { feature: $t$(row.label) })}
              value={selected[row.id]}
              on:change={(event) =>
                setFeature(row.id, { connection: event.currentTarget.value, model: '' })}
            >
              {#if row.inherit}
                <option value="inherit">{$t$(row.inherit)}</option>
              {/if}
              {#each options as connection (connection.id)}
                <option value={connection.id}>{connection.name}</option>
              {/each}
              {#if !options.length && r.connection}
                <!-- The previous release's OpenRouter key, before it became a connection -->
                <option value={r.connection.id}>{r.connection.name}</option>
              {/if}
            </select>
          </td>
          <td class="col-model">
            {#if r.inherited || !r.connection || !r.provider}
              <span class="app-input inherited" aria-disabled="true"
                >{modelShortName(r.model) || '—'}</span
              >
            {:else}
              <AiModelPicker
                connection={r.connection}
                provider={r.provider}
                value={r.model}
                label={$t$('ai.modelFor', { feature: $t$(row.label) })}
                on:change={(event) =>
                  setFeature(row.id, { connection: r.connection?.id ?? '', model: event.detail })}
              />
            {/if}
          </td>
          <td class="col-action">
            {#if row.id === 'voice'}
              <a class="app-button app-button-quiet" href="#ai-read-aloud">{$t$('ai.voiceLink')}</a>
            {:else}
              <button
                type="button"
                class="app-button app-button-quiet"
                aria-expanded={advanced === row.id}
                on:click={() => (advanced = advanced === row.id ? '' : row.id)}
                >{$t$(advanced === row.id ? 'ai.close' : 'ai.advanced')}</button
              >
            {/if}
          </td>
        {/if}
      </tr>
      {#if advanced === row.id && row.id !== 'voice'}
        <tr class="advanced-row">
          <td colspan="4">
            <AiAdvanced
              feature={textFeature(row.id)}
              title={$t$(row.label)}
              provider={r.provider}
              connectionId={r.connection?.id ?? ''}
              model={r.model}
            />
          </td>
        </tr>
      {/if}
    {/each}
  </tbody>
</table>

<style>
  .features {
    margin-top: 0.75rem;
  }

  .features th[scope='row'] {
    width: 9rem;
    padding: 0.6rem 0.75rem 0.6rem 0;
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 400;
    vertical-align: top;
  }

  .name {
    display: block;
  }

  .sub {
    display: block;
    margin-top: 0.1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .needs {
    vertical-align: middle;
  }

  .col-connection {
    width: 27%;
    vertical-align: top;
  }

  .col-model {
    vertical-align: top;
  }

  .col-action {
    width: 1%;
    text-align: right;
    white-space: nowrap;
    vertical-align: top;
  }

  .inherited {
    display: flex;
    align-items: center;
    background: var(--surface-color);
    color: var(--app-muted-fg);
  }

  tr.open {
    border-bottom: 0;
  }

  .advanced-row td {
    padding-top: 0;
  }

  @media (max-width: 640px) {
    .features thead {
      display: none;
    }

    .features tr:not(.advanced-row) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.5rem;
      padding: 0.75rem 0;
    }

    .features th[scope='row'],
    .features td {
      padding: 0;
    }

    .col-connection,
    .col-model,
    .needs {
      grid-column: 1 / -1;
      width: auto;
    }

    .col-action {
      grid-row: 1;
      grid-column: 2;
    }

    .advanced-row,
    .advanced-row td {
      display: block;
    }
  }
</style>
