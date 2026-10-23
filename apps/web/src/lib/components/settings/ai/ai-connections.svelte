<script lang="ts">
  import { testConnection } from '$lib/data/ai-client';
  import {
    aiConnectionCache$,
    aiFeatureState$,
    connectionKey,
    newConnectionId,
    type AiConnectionTest
  } from '$lib/data/ai-connections';
  import { connectionBaseUrl, findProvider } from '$lib/data/ai-providers';
  import { aiConnections$, type AiConnection } from '$lib/data/ai-settings';
  import { t$ } from '$lib/i18n';
  import AiConnectionEditor from './ai-connection-editor.svelte';
  import AiTestResult from './ai-test-result.svelte';
  import { keyTail } from './ai-format';

  /** Id of the connection being edited, or of the new one */
  let editing = '';
  let added: AiConnection | undefined;
  let testingAll = false;

  $: live = [
    ...$aiConnections$.filter((c) => !c.deleted && c.kind === 'text'),
    ...$aiConnections$.filter((c) => !c.deleted && c.kind === 'voice')
  ];
  interface Row {
    connection: AiConnection;
    key: string;
    subtitle: string;
    phoneSubtitle: string;
    models: string;
    needsKey: boolean;
    test?: AiConnectionTest;
  }

  let rows: Row[] = [];

  $: {
    // Keys may also come from the previous release's settings (connectionKey).
    $aiFeatureState$;
    rows = live.map((connection, index) => {
      const provider = findProvider(connection.provider);
      const label = provider?.label ?? connection.provider;
      const cache = $aiConnectionCache$[connection.id];
      const key = connectionKey(connection);
      const count =
        connection.kind === 'voice' && cache?.voices !== undefined
          ? $t$('ai.voicesCount', { count: cache.voices })
          : cache?.models
            ? $t$('ai.modelsCount', { count: cache.models.length })
            : '';
      let detail = '';

      if (provider?.group === 'local' || provider?.id === 'custom') {
        detail = hostOf(connectionBaseUrl(provider, connection.endpoint));
      } else if (connection.kind === 'voice') {
        detail = $t$('ai.voice');
      } else if (index === 0) {
        detail = $t$('ai.default');
      }

      return {
        connection,
        key,
        subtitle: detail ? `${label} · ${detail}` : label,
        phoneSubtitle: count ? `${label} · ${count}` : label,
        models:
          connection.kind === 'voice' && cache?.voices !== undefined
            ? count
            : String(cache?.models?.length ?? '—'),
        needsKey: !!provider?.needsKey && !key,
        test: cache?.test
      };
    });
  }

  function hostOf(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  function add() {
    added = {
      id: newConnectionId('openrouter'),
      name: 'OpenRouter',
      provider: 'openrouter',
      kind: 'text',
      modified: 0
    };
    editing = added.id;
  }

  function close() {
    editing = '';
    added = undefined;
  }

  async function testAll() {
    testingAll = true;

    for (const { connection, needsKey } of rows) {
      if (!needsKey) {
        // One at a time: some free tiers allow few requests a minute.
        // eslint-disable-next-line no-await-in-loop
        await testConnection(connection);
      }
    }

    testingAll = false;
  }
</script>

{#if live.length || added}
  <table class="app-table connections">
    <thead>
      <tr>
        <th scope="col">{$t$('ai.connection')}</th>
        <th scope="col" class="col-key">{$t$('ai.key')}</th>
        <th scope="col" class="col-models">{$t$('ai.models')}</th>
        <th scope="col">{$t$('ai.lastTest')}</th>
        <th scope="col"><span class="sr-only">{$t$('ai.edit')}</span></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as { connection, key, subtitle, phoneSubtitle, models, needsKey, test } (connection.id)}
        <tr class:open={editing === connection.id}>
          <td>
            <span class="name">{connection.name}</span>
            <span class="sub desktop-only">{subtitle}</span>
            <span class="sub phone-only">{phoneSubtitle}</span>
          </td>
          <td class="col-key mono">{keyTail(key)}</td>
          <td class="col-models num">{models}</td>
          <td class="col-test">
            {#if needsKey}
              <AiTestResult
                compact
                test={{ ok: false, title: $t$('ai.needsKey'), detail: '', at: 0 }}
              />
            {:else if test}
              <AiTestResult compact {test} />
            {:else}
              <span class="sub">{$t$('ai.notTested')}</span>
            {/if}
          </td>
          <td class="col-action">
            <button
              type="button"
              class="app-button app-button-quiet"
              aria-expanded={editing === connection.id}
              on:click={() => (editing === connection.id ? close() : (editing = connection.id))}
              >{$t$(editing === connection.id ? 'ai.close' : 'ai.edit')}</button
            >
          </td>
        </tr>
        {#if editing === connection.id}
          <tr class="editor-row">
            <td colspan="5"><AiConnectionEditor {connection} on:close={close} /></td>
          </tr>
        {/if}
      {/each}
      {#if added}
        <tr class="editor-row">
          <td colspan="5"><AiConnectionEditor connection={added} isNew on:close={close} /></td>
        </tr>
      {/if}
    </tbody>
  </table>
{:else}
  <p class="empty">{$t$('ai.noConnections')}</p>
{/if}

<p class="buttons">
  <button type="button" class="app-button" disabled={!!added} on:click={add}
    >{$t$('ai.addConnection')}</button
  >
  {#if live.length}
    <button
      type="button"
      class="app-button app-button-quiet"
      disabled={testingAll}
      on:click={testAll}>{$t$(testingAll ? 'ai.testing' : 'ai.testAll')}</button
    >
  {/if}
  <a class="app-button app-button-quiet" href="#ai-guide">{$t$('ai.setupGuide')}</a>
</p>

<style>
  .connections {
    margin-top: 0.75rem;
  }

  .connections td {
    vertical-align: top;
  }

  .name {
    display: block;
    font-size: var(--type-body);
  }

  .sub {
    display: block;
    margin-top: 0.1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .mono {
    font-family: ui-monospace, monospace;
    font-size: var(--type-small);
    white-space: nowrap;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .col-action {
    width: 1%;
    text-align: right;
    white-space: nowrap;
  }

  .col-action button {
    min-height: 2rem;
  }

  tr.open {
    border-bottom: 0;
  }

  .editor-row td {
    padding-top: 0;
  }

  .phone-only {
    display: none;
  }

  .empty {
    padding: 1rem 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    padding: 1rem 0;
  }

  @media (max-width: 640px) {
    .connections thead,
    .desktop-only,
    .col-key,
    .col-models {
      display: none;
    }

    .connections tr:not(.editor-row) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 0.35rem 0;
    }

    .connections td {
      padding-bottom: 0.15rem;
    }

    .phone-only {
      display: block;
    }

    .col-test {
      grid-row: 2;
      padding-top: 0;
    }

    .col-action {
      grid-column: 2;
      grid-row: 1;
    }

    .editor-row,
    .editor-row td {
      display: block;
    }
  }
</style>
