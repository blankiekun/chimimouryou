<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import AiLanguageToggle from '$lib/components/ai-language-toggle.svelte';
  import { aiLanguage$, aiPromptOverrides$, type AiPromptKey } from '$lib/data/ai-settings';
  import { builtInPrompt } from '$lib/data/ai-prompts';
  import { t$ } from '$lib/i18n';

  /** System prompts per AI language: the built-in one, or the reader's copy (SPEC item 8). */

  const keys: AiPromptKey[] = ['ask', 'chapter', 'recap', 'lore'];

  $: language = $aiLanguage$ === 'ja' ? 'ja' : 'en';
  $: own = $aiPromptOverrides$[language] ?? {};

  /** Without text, drops the copy so the built-in is used again. */
  function setOwn(key: AiPromptKey, text?: string) {
    const { [key]: _, ...rest } = own;

    $aiPromptOverrides$ = {
      ...$aiPromptOverrides$,
      [language]: text === undefined ? rest : { ...rest, [key]: text }
    };
  }
</script>

<SettingsSection id="ai-prompts">
  <SettingsItemGroup title={$t$('ai.language')}>
    <AiLanguageToggle />
  </SettingsItemGroup>
  {#each keys as key (key)}
    <SettingsItemGroup
      title={$t$(`ai.prompt.${key}`)}
      tooltip={key === 'lore' ? $t$('ai.prompt.loreHint') : ''}
    >
      <span slot="header" class="app-tag" class:app-tag-muted={own[key] === undefined}
        >{own[key] === undefined ? $t$('ai.builtIn') : $t$('ai.yourCopy')}</span
      >
      {#if own[key] === undefined}
        <button
          type="button"
          class="app-button app-button-quiet"
          on:click={() => setOwn(key, builtInPrompt(language, key))}>{$t$('ai.editCopy')}</button
        >
      {:else}
        <button type="button" class="app-button app-button-quiet" on:click={() => setOwn(key)}
          >{$t$('ai.resetPrompt')}</button
        >
      {/if}
      <svelte:fragment slot="after">
        {#if own[key] === undefined}
          <details>
            <summary>{$t$('ai.showPrompt')}</summary>
            <pre class="prompt-text">{builtInPrompt(language, key)}</pre>
          </details>
        {:else}
          <textarea
            class="app-input w-full prompt-text"
            rows="8"
            lang={language}
            aria-label={$t$(`ai.prompt.${key}`)}
            value={own[key]}
            on:input={(event) => setOwn(key, event.currentTarget.value)}
          />
        {/if}
      </svelte:fragment>
    </SettingsItemGroup>
  {/each}
</SettingsSection>

<SettingsSection id="ai-syncs" wide>
  <table class="app-table syncs" data-settings-item>
    <thead>
      <tr>
        <th scope="col">{$t$('ai.syncs.setting')}</th>
        <th scope="col">{$t$('ai.syncs.where')}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">
          {$t$('ai.syncs.keys')}
          <span class="app-tag app-tag-muted">{$t$('ai.private')}</span>
        </th>
        <td>
          {$t$('ai.syncs.keysWhere')}
          <small>{$t$('ai.syncs.keysNote')}</small>
        </td>
      </tr>
      <tr>
        <th scope="row">
          {$t$('ai.syncs.connections')}
          <span class="app-tag">{$t$('ai.synced')}</span>
        </th>
        <td>
          {$t$('ai.syncs.connectionsWhere')}
        </td>
      </tr>
      <tr>
        <th scope="row">
          {$t$('ai.syncs.rest')}
          <span class="app-tag">{$t$('ai.synced')}</span>
        </th>
        <td>
          {$t$('ai.syncs.restWhere')}
        </td>
      </tr>
    </tbody>
  </table>
</SettingsSection>

<style>
  summary {
    width: fit-content;
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    cursor: pointer;
  }

  .prompt-text {
    font-family: inherit;
    font-size: var(--type-small);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  pre.prompt-text {
    max-height: 16rem;
    overflow: auto;
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: var(--surface-color);
    color: var(--app-muted-fg);
  }

  .syncs th[scope='row'] {
    width: 34%;
    font-weight: 400;
    vertical-align: top;
  }

  .syncs .app-tag {
    display: table;
    margin-top: 0.35rem;
  }

  .syncs small {
    display: block;
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
