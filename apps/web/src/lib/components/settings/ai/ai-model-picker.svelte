<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { loadModels } from '$lib/data/ai-client';
  import { aiConnectionCache$, type AiModel } from '$lib/data/ai-connections';
  import type { AiProvider } from '$lib/data/ai-providers';
  import { modelShortName, type AiConnection } from '$lib/data/ai-settings';
  import { t$, type MessageKey } from '$lib/i18n';
  import { formatContext, formatPrice, freeTag } from './ai-format';

  export let connection: AiConnection;
  export let provider: AiProvider;
  export let value: string;
  /** Names the button for screen readers, e.g. "Ask AI model" */
  export let label: string;

  const dispatch = createEventDispatcher<{ change: string }>();
  const shownRows = 150;

  let open = false;
  let query = '';
  type Filter = 'all' | 'free' | 'suggested';

  const filters: { id: Filter; text: MessageKey }[] = [
    { id: 'all', text: 'ai.filterAll' },
    { id: 'free', text: 'ai.filterFree' },
    { id: 'suggested', text: 'ai.filterSuggested' }
  ];

  let filter: Filter = 'all';
  let typed = '';
  let loading = false;
  let error = '';
  let searchElm: HTMLInputElement;

  $: models = $aiConnectionCache$[connection.id]?.models ?? [];
  $: current = models.find((m) => m.id === value);
  $: suggested = new Set([
    ...(provider.suggested ?? []),
    ...Object.values(provider.defaultModels ?? {})
  ]);
  $: matching = models
    .filter((m) => filter !== 'free' || m.free)
    .filter((m) => filter !== 'suggested' || suggested.has(m.id))
    .filter((m) => {
      const q = query.trim().toLowerCase();

      return !q || m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q);
    })
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.id.localeCompare(b.id));
  $: sortedByPrice = models.some((m) => m.price !== undefined);

  async function toggle() {
    open = !open;

    if (!open) {
      return;
    }

    query = '';
    typed = '';
    await tick();
    searchElm?.focus();

    if (!models.length && !provider.models) {
      loading = true;
      error = '';

      try {
        await loadModels(connection);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    }
  }

  function choose(id: string) {
    dispatch('change', id.trim());
    open = false;
  }

  function vendor(model: AiModel) {
    // OpenRouter names read "Google: Gemma 3 27B"; the vendor is enough under the id.
    if (model.name?.includes(':')) {
      return model.name.split(':')[0];
    }

    return model.name ?? (model.id.includes('/') ? model.id.split('/')[0].replace(/^~/, '') : '');
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      open = false;
    }
  }
</script>

<div class="picker" on:keydown={onKeydown} role="presentation">
  <button
    type="button"
    class="app-input trigger"
    aria-expanded={open}
    aria-label="{label}: {value}"
    on:click={toggle}
  >
    <span class="trigger-model" title={value}>{modelShortName(value) || '—'}</span>
    {#if current?.price !== undefined}
      <span class="trigger-price"
        >{$t$('ai.perMillion', { price: formatPrice(current.price) })}</span
      >
    {/if}
    <span class="caret" aria-hidden="true" />
  </button>

  {#if open}
    <div class="panel">
      <input
        bind:this={searchElm}
        class="app-input w-full"
        type="search"
        placeholder={$t$('ai.searchModels')}
        aria-label={$t$('ai.searchModels')}
        bind:value={query}
      />
      <div class="filters">
        <div class="app-segmented" role="radiogroup" aria-label={$t$('ai.modelFilter')}>
          {#each filters as { id, text }}
            <button
              type="button"
              role="radio"
              class="app-segment"
              class:app-segment-selected={filter === id}
              aria-checked={filter === id}
              on:click={() => (filter = id)}>{$t$(text)}</button
            >
          {/each}
        </div>
        <span class="count">
          {$t$('ai.modelsCount', { count: matching.length })}{sortedByPrice
            ? ` · ${$t$('ai.sortedByPrice')}`
            : ''}
        </span>
      </div>

      {#if loading}
        <p class="note">{$t$('ai.loadingModels')}</p>
      {:else if error}
        <p class="note error">{error}</p>
      {/if}

      <div class="models-scroll">
        <table class="app-table models">
          <thead>
            <tr>
              <th scope="col">{$t$('ai.model')}</th>
              <th scope="col" class="n">{$t$('ai.context')}</th>
              <th scope="col" class="n">{$t$('ai.perMillionIn')}</th>
            </tr>
          </thead>
          <tbody>
            {#each matching.slice(0, shownRows) as model (model.id)}
              {@const tag = freeTag(provider, model)}
              <tr class:selected={model.id === value}>
                <td>
                  <button type="button" class="row-button" on:click={() => choose(model.id)}>
                    <span class="model-id">
                      {modelShortName(model.id)}
                      {#if tag === 'trains'}
                        <span class="app-tag app-tag-warning">{$t$('ai.freeTrains')}</span>
                      {:else if tag === 'free'}
                        <span class="app-tag">{$t$('ai.free')}</span>
                      {/if}
                    </span>
                    <span class="model-sub">{vendor(model)}</span>
                  </button>
                </td>
                <td class="n">{formatContext(model.context)}</td>
                <td class="n">{formatPrice(model.price)}</td>
              </tr>
            {/each}
            {#if matching.length > shownRows}
              <tr>
                <td colspan="3" class="note"
                  >{$t$('ai.moreModels', { count: matching.length - shownRows })}</td
                >
              </tr>
            {/if}
            <tr>
              <td colspan="3">
                <form class="typed" on:submit|preventDefault={() => typed.trim() && choose(typed)}>
                  <input
                    class="typed-input"
                    placeholder={$t$('ai.typeModelId')}
                    aria-label={$t$('ai.typeModelId')}
                    spellcheck="false"
                    bind:value={typed}
                  />
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<style>
  .picker {
    min-width: 0;
  }

  .trigger {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.6rem;
    text-align: left;
  }

  .trigger-model {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trigger-price {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .caret {
    width: 0;
    height: 0;
    flex: none;
    margin-left: auto;
    border-top: 0.3rem solid var(--app-muted-fg);
    border-right: 0.25rem solid transparent;
    border-left: 0.25rem solid transparent;
  }

  .panel {
    display: grid;
    gap: 0.75rem;
    padding: 0.75rem;
    margin-top: 0.4rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    background: var(--background-color);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .count,
  .note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .error {
    color: var(--app-danger-color);
  }

  .models-scroll {
    max-height: 22rem;
    overflow-y: auto;
  }

  .models {
    table-layout: fixed;
  }

  .models th:nth-child(2) {
    width: 4.5rem;
  }

  .models th:nth-child(3) {
    width: 5.5rem;
  }

  .n {
    text-align: right !important;
    white-space: nowrap;
  }

  .models td {
    padding-top: 0.35rem;
    padding-bottom: 0.35rem;
  }

  tr.selected {
    background: var(--app-spot-tint);
  }

  .row-button {
    display: block;
    width: 100%;
    min-height: 2.25rem;
    text-align: left;
  }

  .row-button:hover .model-id {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .model-id {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    overflow-wrap: anywhere;
  }

  .model-sub {
    display: block;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .typed-input {
    width: 100%;
    min-height: 2.25rem;
    border: 0;
    background: transparent;
    color: var(--font-color);
  }

  .typed-input::placeholder {
    color: var(--app-muted-fg);
  }
</style>
