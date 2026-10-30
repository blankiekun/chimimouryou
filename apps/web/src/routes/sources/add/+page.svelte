<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import { addServer, SourceError } from '$lib/data/sources/server-sources';
  import { onMount } from 'svelte';

  /**
   * Add a source (boards 2, 2a, 2b): a Suwayomi server or an OPDS catalog. The import service tests
   * the address with the credentials, then adds it; its errors sit under the field they concern.
   * Web novel sites need no setup, so that choice only points to their search.
   */

  type Kind = 'sites' | 'suwayomi' | 'opds';

  const kinds: { kind: Kind; title: string; detail: string }[] = [
    {
      kind: 'sites',
      title: 'Web novel sites',
      detail: 'Syosetu, Kakuyomu. Built in, nothing to set up.'
    },
    { kind: 'suwayomi', title: 'Suwayomi', detail: 'A Suwayomi server you run (manga).' },
    { kind: 'opds', title: 'OPDS catalog', detail: 'Komga, Kavita, Calibre-web.' }
  ];

  let kind = $state<Kind>('opds');
  let url = $state('');
  let name = $state('');
  let user = $state('');
  let password = $state('');
  let busy = $state(false);
  let failed = $state(false);
  let errors = $state<Record<string, string>>({});

  const allowed = $derived(standalone || hasPermission($account$, 'import'));
  const label = $derived(kind === 'suwayomi' ? 'Suwayomi' : 'the catalog');

  onMount(() => {
    $libraryTab$ = 'store';
  });

  function choose(next: Kind) {
    kind = next;
    errors = {};
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (kind === 'sites') return;
    errors = {};
    if (!/^https?:\/\/[^/\s]+/i.test(url.trim())) {
      errors = { url: 'Use an address starting with http:// or https://.' };
      failed = true;
      return;
    }
    busy = true;
    try {
      const added = await addServer({
        type: kind,
        url: url.trim(),
        name: name.trim(),
        user,
        password
      });
      await goto(`${pagePath}/sources/browse?server=${added.server.id}`);
    } catch (error: any) {
      failed = true;
      const field = error instanceof SourceError && error.field ? error.field : 'form';
      errors = { [field === 'type' ? 'form' : field]: error.message };
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Add a source</title>
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="add-page">
    <a class="app-button-quiet add-back" href="{pagePath}/sources">← Sources</a>
    <h1 class="add-title">Add a source</h1>

    {#if !allowed}
      <p class="add-note">
        {'Adding sources needs an account with the "Add books" permission. Ask an admin.'}
      </p>
    {:else}
      <form class="add-layout" onsubmit={submit} novalidate>
        <fieldset class="add-types">
          <legend class="add-legend"><SectionHead number={1} title="Type" level="h2" /></legend>
          {#each kinds as option (option.kind)}
            <label class="add-type" class:add-type-selected={kind === option.kind}>
              <input
                type="radio"
                name="kind"
                value={option.kind}
                checked={kind === option.kind}
                onchange={() => choose(option.kind)}
              />
              <span>
                <span class="add-type-title">{option.title}</span>
                <span class="add-hint">{option.detail}</span>
              </span>
            </label>
          {/each}
        </fieldset>

        <section class="add-server" aria-labelledby="add-server">
          {#if kind === 'sites'}
            <SectionHead number={2} title="Sites" id="add-server" />
            <p class="add-hint add-gap">
              Paste a work's link in Sources, or search the sites: their works become volumes in
              Calibre.
            </p>
            <a class="app-button app-button-primary add-open" href="{pagePath}/sources/search"
              >Search web novels</a
            >
          {:else}
            <SectionHead number={2} title="Server" id="add-server" />
            <label class="add-label" for="add-url">Address</label>
            <input
              id="add-url"
              class="app-input"
              class:add-invalid={errors.url}
              type="url"
              inputmode="url"
              autocomplete="off"
              placeholder={kind === 'suwayomi'
                ? 'http://suwayomi.lan:4567'
                : 'http://komga.lan:25600/opds/v1.2/catalog'}
              aria-invalid={!!errors.url}
              aria-describedby="add-url-help"
              bind:value={url}
            />
            <p id="add-url-help" class={errors.url ? 'add-error' : 'add-hint'}>
              {errors.url ??
                (kind === 'suwayomi'
                  ? 'The server’s address as this server sees it.'
                  : 'The catalog’s address as this server sees it.')}
            </p>

            <label class="add-label" for="add-name">Name</label>
            <input
              id="add-name"
              class="app-input"
              autocomplete="off"
              placeholder={kind === 'suwayomi' ? 'Suwayomi' : 'Komga'}
              aria-describedby="add-name-help"
              bind:value={name}
            />
            <p id="add-name-help" class={errors.name ? 'add-error' : 'add-hint'}>
              {errors.name ?? 'Shown in your list of sources.'}
            </p>

            <div class="add-pair">
              <div>
                <label class="add-label" for="add-user">User name</label>
                <input
                  id="add-user"
                  class="app-input"
                  autocomplete="off"
                  placeholder="Optional"
                  bind:value={user}
                />
              </div>
              <div>
                <label class="add-label" for="add-password">Password</label>
                <input
                  id="add-password"
                  class="app-input"
                  class:add-invalid={errors.password}
                  type="password"
                  autocomplete="new-password"
                  placeholder="Optional"
                  aria-invalid={!!errors.password}
                  aria-describedby="add-password-help"
                  bind:value={password}
                />
              </div>
            </div>
            <p id="add-password-help" class={errors.password ? 'add-error' : 'add-hint'}>
              {errors.password ??
                (standalone
                  ? `Only if ${label} asks for one. Kept in this browser only, never synced.`
                  : `Only if ${label} asks for one. Kept on the server, encrypted, and never sent back to a browser.`)}
            </p>

            {#if errors.form}<p class="add-error" role="alert">{errors.form}</p>{/if}

            <div class="add-actions">
              <button type="submit" class="app-button app-button-primary" disabled={busy}
                >{busy ? 'Testing…' : failed ? 'Test again' : 'Add source'}</button
              >
              <a class="app-button app-button-secondary" href="{pagePath}/sources">Cancel</a>
            </div>
            <p class="add-hint" role="status">
              {busy ? `Asking ${url.trim() || 'the server'} for its catalog…` : ''}
            </p>
          {/if}
        </section>
      </form>
    {/if}
  </main>
</div>

<style>
  .add-page {
    max-width: 75rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  .add-back {
    display: inline-block;
    margin-bottom: 1rem;
  }

  .add-title {
    margin-bottom: 1.5rem;
    font-size: var(--type-h1);
    line-height: 1.2;
  }

  .add-note {
    color: var(--app-muted-fg);
  }

  .add-layout {
    display: grid;
    gap: 2rem;
  }

  .add-types {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .add-legend {
    width: 100%;
    margin-bottom: 0.75rem;
    padding: 0;
  }

  .add-type {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 0.85rem 0.5rem;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
  }

  .add-type:first-of-type {
    border-top: 2px solid var(--font-color);
  }

  .add-type input {
    flex: none;
    width: 1.1rem;
    height: 1.1rem;
    margin-top: 0.2rem;
    accent-color: var(--accent-strong-color);
  }

  .add-type-selected {
    background: var(--app-spot-tint);
  }

  .add-type-title {
    display: block;
    font-weight: 700;
  }

  .add-label {
    display: block;
    margin: 1rem 0 0.35rem;
    font-weight: 700;
    font-size: var(--type-small);
  }

  .add-server .app-input {
    width: 100%;
    height: 2.75rem;
  }

  .add-server .add-invalid {
    border-color: var(--app-danger-color);
  }

  .add-hint {
    display: block;
    margin-top: 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .add-gap {
    margin: 0.75rem 0 1rem;
  }

  .add-error {
    margin-top: 0.3rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .add-pair {
    display: grid;
    gap: 0 1rem;
  }

  .add-actions {
    display: grid;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .add-actions .app-button {
    text-align: center;
  }

  @media (min-width: 768px) {
    .add-page {
      padding: 6rem 2.5rem 4rem;
    }

    .add-layout {
      grid-template-columns: minmax(0, 28rem) minmax(0, 32rem);
      gap: 5rem;
      align-items: start;
    }

    .add-pair {
      grid-template-columns: 1fr 1fr;
    }

    .add-actions {
      display: flex;
    }
  }
</style>
