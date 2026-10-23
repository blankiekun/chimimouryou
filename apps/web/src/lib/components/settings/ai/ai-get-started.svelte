<script lang="ts">
  import PointBox from '$lib/components/point-box.svelte';
  import { testConnection } from '$lib/data/ai-client';
  import { connectProvider } from '$lib/data/ai-connections';
  import { aiProviders, findProvider, type AiProvider } from '$lib/data/ai-providers';
  import { openRouterSignInAvailable, openRouterSignInUrl } from '$lib/data/openrouter-oauth';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  /** The settings page is finishing a sign-in that came back from OpenRouter */
  export let signingIn = false;
  export let signInError = '';

  /** Cloud providers a pasted key is enough for; servers on this computer go through Add connection */
  const keyed = aiProviders.filter((p) => p.kind === 'text' && p.needsKey);
  const others = ['gemini', 'groq', 'openai', 'anthropic'];

  let oauth = false;
  let canPaste = false;
  let starting = false;
  let providerId = 'openrouter';
  let key = '';

  $: provider = findProvider(providerId) as AiProvider;
  $: keyHost = provider.keyUrl ? new URL(provider.keyUrl).host : '';

  onMount(() => {
    oauth = openRouterSignInAvailable();
    canPaste = !!navigator.clipboard?.readText;
  });

  async function signIn() {
    starting = true;
    window.location.assign(await openRouterSignInUrl());
  }

  async function paste() {
    try {
      key = (await navigator.clipboard.readText()).trim();
    } catch {
      // Refused: the field still takes a normal paste.
    }
  }

  function connect() {
    // The first test also loads the model list; its result shows in the Connections table.
    testConnection(connectProvider(providerId, key));
  }

  const link = (href: string, text: string) =>
    `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
</script>

<PointBox label={$t$('ai.startHere')}>
  <p class="lead">{$t$('ai.startHereLead')}</p>

  {#if oauth}
    <div class="oauth">
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={starting || signingIn}
        on:click={signIn}>{$t$(signingIn ? 'ai.connecting' : 'ai.connectOpenRouter')}</button
      >
      <p class="hint">{$t$('ai.connectOpenRouterHint')}</p>
    </div>
  {:else}
    <p class="hint http-note">{$t$('ai.connectOpenRouterHttps')}</p>
  {/if}
  {#if signInError}
    <p class="error" role="alert">{signInError}</p>
  {/if}

  <form class="paste" on:submit|preventDefault={connect}>
    <h3>{$t$(oauth ? 'ai.orPasteKey' : 'ai.pasteKey')}</h3>
    <div class="paste-row">
      <select class="app-input" aria-label={$t$('ai.provider')} bind:value={providerId}>
        {#each keyed as p (p.id)}
          <option value={p.id}>{p.label}</option>
        {/each}
      </select>
      <span class="key-field">
        <input
          class="app-input w-full"
          type="password"
          autocomplete="off"
          spellcheck="false"
          aria-label={$t$('ai.apiKey')}
          placeholder={providerId === 'openrouter' ? 'sk-or-v1-…' : $t$('ai.apiKey')}
          bind:value={key}
        />
        {#if canPaste}
          <button type="button" class="app-button app-button-quiet" on:click={paste}
            >{$t$('ai.paste')}</button
          >
        {/if}
      </span>
      <button type="submit" class="app-button" disabled={!key.trim()}>{$t$('ai.connect')}</button>
    </div>
    {#if provider.free === 'trains'}
      <p class="hint"><span class="app-tag app-tag-warning">{$t$('ai.freeTrains')}</span></p>
    {/if}

    <h4>{$t$('ai.gettingKey', { provider: provider.label })}</h4>
    <!-- Our own strings with links as params, so translations can put them anywhere. -->
    <ol class="steps">
      {#if providerId === 'openrouter'}
        <li>
          {@html $t$('ai.guideAccount', { link: link('https://openrouter.ai', 'openrouter.ai') })}
        </li>
        <li>{$t$('ai.stepOpenRouterCredits')}</li>
        <li>
          {@html $t$('ai.stepOpenRouterKey', {
            link: link('https://openrouter.ai/settings/keys', 'Settings → API Keys')
          })}
        </li>
        <li>{@html $t$('ai.stepOpenRouterPaste', { prefix: '<code>sk-or-</code>' })}</li>
      {:else}
        {#if keyHost}
          <li>{@html $t$('ai.stepCreateKey', { link: link(provider.keyUrl ?? '', keyHost) })}</li>
        {/if}
        <li>{$t$('ai.stepPaste')}</li>
      {/if}
    </ol>
  </form>

  <div class="others">
    <h4>{$t$('ai.otherProviders')}</h4>
    <p class="other-links">
      {#each others as id}
        {@const p = findProvider(id)}
        {#if p}
          <button
            type="button"
            class="app-button app-button-quiet other"
            aria-pressed={providerId === id}
            on:click={() => (providerId = id)}
            >{p.label}{#if p.free === 'trains'}
              ({$t$('ai.freeTrains').toLowerCase()}){:else if p.free}
              ({$t$('ai.free').toLowerCase()}){/if}</button
          >
        {/if}
      {/each}
    </p>
    <p class="hint">{$t$('ai.otherProvidersHint')}</p>
  </div>
</PointBox>

<style>
  .lead {
    max-width: 40rem;
    font-size: var(--type-h2);
    line-height: 1.45;
  }

  .oauth {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    margin-top: 1rem;
  }

  .oauth .hint {
    max-width: 26rem;
  }

  .hint {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .http-note {
    margin-top: 0.75rem;
  }

  .error {
    margin-top: 0.75rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .paste {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border-color);
  }

  h3 {
    font-size: var(--type-body);
    font-weight: 700;
  }

  h4 {
    margin-top: 1.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .paste-row {
    display: grid;
    grid-template-columns: minmax(0, 14rem) minmax(0, 22rem) auto;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .paste-row + .hint {
    margin-top: 0.5rem;
  }

  .key-field {
    position: relative;
    display: flex;
    min-width: 0;
  }

  .key-field input {
    padding-right: 4.5rem;
  }

  .key-field button {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
  }

  .steps {
    display: grid;
    max-width: 36rem;
    gap: 0.5rem;
    margin-top: 0.5rem;
    counter-reset: step;
    line-height: 1.55;
  }

  .steps li {
    position: relative;
    padding-left: 1.9rem;
    counter-increment: step;
  }

  /* Step numbers in a square spot-colour frame, like the setup guide */
  .steps li::before {
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

  .steps :global(a) {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .steps :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
  }

  .other-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin-top: 0.35rem;
  }

  .other[aria-pressed='true'] {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .others .hint {
    margin-top: 0.35rem;
  }

  @media (max-width: 640px) {
    .lead {
      font-size: var(--type-body);
    }

    .paste-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .oauth .app-button-primary {
      width: 100%;
    }
  }
</style>
