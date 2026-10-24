<script lang="ts">
  /**
   * How to install the standalone on this browser (plan S6): a ruled note under Home's shelves
   * until "Not now", and a permanent row in Settings → General.
   */
  import { browser } from '$app/env';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import {
    installed$,
    installHintDismissed$,
    installPrompt$,
    installTexts,
    installWay,
    promptInstall
  } from '$lib/data/install-app';

  export let settings = false;

  $: way = browser
    ? installWay(navigator.userAgent, navigator.maxTouchPoints, !!$installPrompt$, $installed$)
    : 'none';
  $: texts =
    way === 'none'
      ? {
          title: 'Install chimimouryou',
          text: "This browser doesn't offer to install it. Chrome, Edge, Firefox on Android and Safari on iPhone do."
        }
      : installTexts[way];
</script>

{#if settings}
  <SettingsItemGroup title={texts.title} tooltip={texts.text}>
    {#if way === 'prompt'}
      <button type="button" class="app-button" on:click={promptInstall}>Install app</button>
    {/if}
    {#each texts.links ?? [] as link}
      <a class="install-link" href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
    {/each}
  </SettingsItemGroup>
{:else if way !== 'none' && way !== 'installed' && !$installHintDismissed$}
  <aside class="install-hint" aria-label={texts.title}>
    <div class="install-hint-text">
      <h2>{texts.title}</h2>
      <p>{texts.text}</p>
      {#each texts.links ?? [] as link}
        <a class="install-link" href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
      {/each}
    </div>
    <div class="install-hint-actions">
      {#if way === 'prompt'}
        <button type="button" class="app-button" on:click={promptInstall}>Install app</button>
      {/if}
      <button
        type="button"
        class="app-button app-button-quiet"
        on:click={() => installHintDismissed$.next(true)}
      >
        Not now
      </button>
    </div>
  </aside>
{/if}

<style>
  .install-hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem 2rem;
    padding: 1.25rem 0;
    border-block: 1px solid var(--border-color);
  }

  .install-hint-text {
    flex: 1 1 18rem;
    min-width: 0;
  }

  .install-hint h2 {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
  }

  .install-hint p {
    max-width: 40rem;
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.55;
  }

  .install-link {
    color: var(--accent-strong-color);
    font-weight: 700;
    white-space: nowrap;
  }

  .install-link:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .install-hint-text .install-link {
    display: inline-block;
    margin-top: 0.5rem;
    margin-inline-end: 1.5rem;
    font-size: var(--type-small);
  }

  .install-hint-actions {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }
</style>
