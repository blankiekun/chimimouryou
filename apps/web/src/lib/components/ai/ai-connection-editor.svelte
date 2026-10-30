<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { AiError, loadModels, testConnection } from '$lib/data/ai/ai-client';
  import {
    aiConnectionCache$,
    connectionKey,
    deleteConnection,
    saveConnection,
    type AiConnectionTest
  } from '$lib/data/ai/ai-connections';
  import {
    aiProviders,
    findProvider,
    type AiProvider,
    type AiProviderGroup
  } from '$lib/data/ai/ai-providers';
  import type { AiConnection } from '$lib/data/ai/ai-settings';
  import { t$, type MessageKey } from '$lib/i18n';
  import AiTestResult from './ai-test-result.svelte';
  import { whenTested } from './ai-format';

  /** The connection to edit; a new one isn't saved until Save. */
  export let connection: AiConnection;
  export let isNew = false;

  const dispatch = createEventDispatcher<{ close: void }>();
  const groups: [AiProviderGroup, MessageKey][] = [
    ['aggregator', 'ai.groupAggregator'],
    ['free', 'ai.groupFree'],
    ['direct', 'ai.groupDirect'],
    ['local', 'ai.groupLocal'],
    ['other', 'ai.groupOther']
  ];

  let draft = { ...connection };
  let key = isNew ? '' : connectionKey(connection);
  let showKey = false;
  let loading = false;
  let modelsError = '';
  let testing = false;
  let test: AiConnectionTest | undefined;

  $: provider = findProvider(draft.provider) as AiProvider;
  $: cache = $aiConnectionCache$[draft.id];
  $: modelCount =
    provider?.kind === 'voice' && cache?.voices !== undefined
      ? $t$('ai.voicesCount', { count: cache.voices })
      : cache?.models
        ? $t$('ai.modelsCount', { count: cache.models.length })
        : '';

  function optionLabel(p: AiProvider) {
    const tag =
      p.free === 'trains' ? $t$('ai.freeTrains') : p.free === 'free' ? $t$('ai.free') : '';

    return tag ? `${p.label} — ${tag}` : p.label;
  }

  function changeProvider(id: string) {
    const next = findProvider(id);

    if (!next) {
      return;
    }

    // Keep a name the reader typed; otherwise name it after the provider.
    if (!draft.name.trim() || draft.name === provider?.label) {
      draft.name = next.label;
    }

    // Filled in so it's clear where requests go; empty falls back to the same address.
    draft = { ...draft, provider: id, kind: next.kind, endpoint: next.baseUrl };
    test = undefined;
    reload();
  }

  async function reload() {
    if (provider.needsKey && !key.trim() && provider.id !== 'openrouter') {
      modelsError = '';
      return;
    }

    loading = true;
    modelsError = '';

    try {
      await loadModels(draft, key.trim());
    } catch (error) {
      modelsError = error instanceof AiError ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  async function runTest() {
    testing = true;
    test = await testConnection(draft, key.trim());
    testing = false;
  }

  function save() {
    saveConnection({ ...draft, name: draft.name.trim() || provider.label }, key);
    dispatch('close');
  }

  function remove() {
    deleteConnection(draft.id);
    dispatch('close');
  }

  onMount(() => {
    if (!cache?.models) {
      reload();
    }
  });
</script>

<form class="editor" on:submit|preventDefault={save}>
  <div class="field">
    <div class="field-text">
      <label for="ai-provider-{draft.id}">{$t$('ai.provider')}</label>
    </div>
    <div class="field-control">
      <select
        id="ai-provider-{draft.id}"
        class="app-input w-full"
        value={draft.provider}
        on:change={(event) => changeProvider(event.currentTarget.value)}
      >
        {#each groups as [group, label]}
          <optgroup label={$t$(label)}>
            {#each aiProviders.filter((p) => p.group === group) as p (p.id)}
              <option value={p.id}>{optionLabel(p)}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      {#if provider?.hint || provider?.free}
        <p class="provider-note">
          {provider.hint ?? ''}
          {#if provider.free === 'trains'}
            <span class="app-tag app-tag-warning">{$t$('ai.freeTrains')}</span>
          {:else if provider.free === 'free'}
            <span class="app-tag">{$t$('ai.free')}</span>
          {/if}
        </p>
      {/if}
    </div>
  </div>

  <div class="field">
    <div class="field-text">
      <label for="ai-name-{draft.id}">{$t$('ai.connectionName')}</label>
    </div>
    <div class="field-control">
      <input id="ai-name-{draft.id}" class="app-input w-full" bind:value={draft.name} />
    </div>
  </div>

  {#if provider?.needsKey || provider?.group === 'other'}
    <div class="field">
      <div class="field-text">
        <label for="ai-key-{draft.id}"
          >{$t$('ai.apiKey')} <span class="app-tag app-tag-muted">{$t$('ai.private')}</span></label
        >
        <p>
          {#if provider.keyUrl}
            <a href={provider.keyUrl} target="_blank" rel="noreferrer"
              >{new URL(provider.keyUrl).host}</a
            >
          {/if}
          {$t$(provider.needsKey ? 'ai.apiKeyHint' : 'ai.apiKeyOptional')}
        </p>
      </div>
      <div class="field-control secret-field">
        <input
          id="ai-key-{draft.id}"
          class="app-input w-full"
          type={showKey ? 'text' : 'password'}
          autocomplete="off"
          spellcheck="false"
          value={key}
          on:input={(event) => (key = event.currentTarget.value)}
          on:change={reload}
        />
        <button
          type="button"
          class="app-button app-button-quiet"
          aria-pressed={showKey}
          on:click={() => (showKey = !showKey)}>{$t$(showKey ? 'ai.hideKey' : 'ai.showKey')}</button
        >
      </div>
    </div>
  {/if}

  <div class="field">
    <div class="field-text">
      <label for="ai-endpoint-{draft.id}">{$t$('ai.endpoint')}</label>
      {#if provider?.id === 'custom'}<p>{$t$('ai.endpointCustomHint')}</p>{/if}
    </div>
    <div class="field-control">
      <input
        id="ai-endpoint-{draft.id}"
        class="app-input w-full"
        inputmode="url"
        spellcheck="false"
        placeholder={provider?.baseUrl || 'https://…/v1'}
        bind:value={draft.endpoint}
        on:change={reload}
      />
    </div>
  </div>

  <div class="field">
    <div class="field-text">
      <span class="field-label">{$t$('ai.models')}</span>
    </div>
    <div class="field-control models-line" aria-live="polite">
      <span class="muted">
        {#if loading}
          {$t$('ai.loadingModels')}
        {:else if modelsError}
          <span class="error">{modelsError}</span>
        {:else if modelCount}
          {modelCount}{cache?.loadedAt
            ? ` · ${$t$('ai.loaded', { when: whenTested(cache.loadedAt) })}`
            : ''}
        {:else}
          {$t$('ai.modelsAfterKey')}
        {/if}
      </span>
      <button type="button" class="app-button app-button-quiet" disabled={loading} on:click={reload}
        >{$t$('ai.reload')}</button
      >
    </div>
  </div>

  <div class="test-line">
    <button type="button" class="app-button" disabled={testing} on:click={runTest}
      >{$t$('ai.testConnection')}</button
    >
    {#if testing}
      <AiTestResult test={{ ok: false, title: $t$('ai.testing'), detail: '', at: 0 }} pending />
    {:else if test}
      <AiTestResult {test} />
    {/if}
  </div>

  <div class="actions">
    <button type="submit" class="app-button app-button-primary">{$t$('ai.save')}</button>
    <button type="button" class="app-button app-button-quiet" on:click={() => dispatch('close')}
      >{$t$('ai.cancel')}</button
    >
    {#if !isNew}
      <button type="button" class="app-button app-button-quiet danger" on:click={remove}
        >{$t$('ai.deleteConnection')}</button
      >
    {/if}
  </div>
</form>

<style>
  .editor {
    display: grid;
    padding: 0.25rem 1rem 1rem;
    margin: 0.25rem 0 0.75rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
  }

  .field {
    display: grid;
    gap: 0.5rem 1.5rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  @media (min-width: 768px) {
    .field {
      grid-template-columns: minmax(0, 1fr) minmax(0, 19rem);
      align-items: center;
    }
  }

  .field-text label,
  .field-label {
    display: block;
    font-size: var(--type-body);
  }

  .field-text p,
  .provider-note,
  .muted {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .field-text a {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .provider-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .secret-field {
    position: relative;
  }

  .secret-field input {
    padding-right: 3.75rem;
    font-family: ui-monospace, monospace;
    font-size: var(--type-small);
  }

  .secret-field button {
    position: absolute;
    top: 50%;
    right: 0.6rem;
    font-size: var(--type-label);
    transform: translateY(-50%);
  }

  .models-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-variant-numeric: tabular-nums;
  }

  .models-line .muted {
    margin: 0;
  }

  .error {
    color: var(--app-danger-color);
  }

  .test-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 1rem 0 0.25rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding-top: 0.85rem;
  }

  .danger {
    margin-left: auto;
    color: var(--app-danger-color);
  }
</style>
