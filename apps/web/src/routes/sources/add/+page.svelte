<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import NeedsApp from '$lib/components/sources/needs-app.svelte';
  import Switch from '$lib/components/switch.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import { page } from '$lib/data/page-store';
  import {
    addRepo,
    addServer,
    getRepo,
    lookUpRepo,
    removeRepo,
    setExtension,
    SourceError,
    updateExtension
  } from '$lib/data/sources/server-sources';
  import { needsAppMessage } from '$lib/data/sources/transport';
  import type { SourceRepo, SourceRepoExtension } from '$lib/data/sources/types';
  import { onMount } from 'svelte';

  /**
   * Add a source (boards 2, 2a, 2b, 2c): a Suwayomi server or an OPDS catalog (the import service
   * tests the address with the credentials, then adds it; its errors sit under the field they
   * concern), or an extension repository (this device only: look up its index.json, pick the
   * extensions to install). Web novel sites need no setup, so that choice only points to their
   * search. ?repo=<id> manages an added repository: switches and Update act at once.
   */

  type Kind = 'sites' | 'suwayomi' | 'opds' | 'repo';

  const kinds: { kind: Kind; title: string; detail: string }[] = [
    {
      kind: 'sites',
      title: 'Web novel sites',
      detail: 'Syosetu, Kakuyomu. Built in, nothing to set up.'
    },
    { kind: 'suwayomi', title: 'Suwayomi', detail: 'A Suwayomi server you run (manga).' },
    { kind: 'opds', title: 'OPDS catalog', detail: 'Komga, Kavita, Calibre-web.' },
    {
      kind: 'repo',
      title: 'Extension repository',
      detail: 'Manga and novel sources that run on this device.'
    }
  ];
  const SHOWN = 20;

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

  // Extension repository: the looked-up list (adding) or the saved repository (?repo=).
  const repoId = $derived(browser ? Number($page.url.searchParams.get('repo')) || 0 : 0);
  let repo = $state<SourceRepo>();
  let found = $state<SourceRepoExtension[]>();
  let picked = $state<Set<number>>(new Set());
  let filter = $state<'all' | 'manga' | 'novel'>('all');
  let japanese = $state(true);
  let showAll = $state(false);
  let rowBusy = $state(0);
  const list = $derived(repo?.extensions ?? found ?? []);
  const filtered = $derived(
    list.filter(
      (e) => (filter === 'all' || e.kind === filter) && (!japanese || e.lang === 'ja' || !e.lang)
    )
  );
  const shown = $derived(showAll ? filtered : filtered.slice(0, SHOWN));
  const onCount = $derived(repo ? list.filter((e) => e.on && !e.off).length : picked.size);
  const runnable = $derived(list.filter((e) => !e.off));

  onMount(() => {
    $libraryTab$ = 'store';
  });

  $effect(() => {
    if ($page.url.searchParams.get('type') === 'repo') kind = 'repo';
  });

  $effect(() => {
    if (!repoId || !allowed) return;
    kind = 'repo';
    getRepo(repoId).then(
      (loaded) => (repo = loaded),
      (error) => (errors = { form: error.message })
    );
  });

  function choose(next: Kind) {
    kind = next;
    errors = {};
  }

  async function lookUp() {
    errors = {};
    found = undefined;
    busy = true;
    try {
      const looked = await lookUpRepo(url);
      found = looked.extensions;
      // Japanese JS sources start on; the reader switches off what they don't want.
      picked = new Set(looked.extensions.filter((e) => !e.off && e.lang === 'ja').map((e) => e.id));
    } catch (error: any) {
      failed = true;
      errors = {
        [error instanceof SourceError && error.field ? error.field : 'form']: error.message
      };
    } finally {
      busy = false;
    }
  }

  async function toggle(extension: SourceRepoExtension, on: boolean) {
    errors = {};
    if (!repo) {
      const next = new Set(picked);
      if (on) next.add(extension.id);
      else next.delete(extension.id);
      picked = next;
      return;
    }
    rowBusy = extension.id;
    try {
      repo = await setExtension(repo.id, extension.id, on);
    } catch (error: any) {
      errors = { [`row${extension.id}`]: error.message };
    } finally {
      rowBusy = 0;
    }
  }

  async function update(extension: SourceRepoExtension) {
    if (!repo) return;
    errors = {};
    rowBusy = extension.id;
    try {
      repo = await updateExtension(repo.id, extension.id);
    } catch (error: any) {
      errors = { [`row${extension.id}`]: error.message };
    } finally {
      rowBusy = 0;
    }
  }

  async function forget() {
    if (!repo) return;
    if (
      !window.confirm(
        `Remove ${repo.name}? Its extensions are deleted from this device; volumes you added stay in the library.`
      )
    )
      return;
    await removeRepo(repo.id);
    await goto(`${pagePath}/sources`);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (kind === 'sites') return;
    if (kind === 'repo') {
      if (!found) return lookUp();
      busy = true;
      errors = {};
      try {
        const added = await addRepo(url, [...picked]);
        const first = added.extensions.find((e) => e.on);
        await goto(
          first
            ? `${pagePath}/sources/browse?ext=${encodeURIComponent(first.site)}`
            : `${pagePath}/sources/add?repo=${added.id}`
        );
      } catch (error: any) {
        failed = true;
        errors = {
          [error instanceof SourceError && error.field ? error.field : 'form']: error.message
        };
      } finally {
        busy = false;
      }
      return;
    }
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

{#snippet extensionList()}
  <div class="app-segmented add-filter" role="radiogroup" aria-label="Show">
    {#each [['all', 'All'], ['manga', 'Manga'], ['novel', 'Novels']] as const as [value, text] (value)}
      <button
        type="button"
        role="radio"
        class="app-segment"
        class:app-segment-selected={filter === value}
        aria-checked={filter === value}
        onclick={() => (filter = value)}>{text}</button
      >
    {/each}
  </div>
  <div class="add-extension add-japanese">
    <span id="add-japanese">Japanese only</span>
    <Switch
      checked={japanese}
      stateText={false}
      aria-labelledby="add-japanese"
      onchange={(next) => (japanese = next)}
    />
  </div>
  <ul class="add-extensions">
    {#each shown as extension (extension.id)}
      <li class="add-extension">
        <div class="add-extension-text">
          <p class="add-extension-name">
            <span id="add-ext-{extension.id}" lang="ja">{extension.name}</span>
            {#if extension.tag}<span class="add-tag">{extension.tag}</span>{/if}
          </p>
          <p class="add-hint">
            {extension.kind === 'manga' ? 'Manga' : 'Novels'}{extension.lang
              ? ` · ${extension.lang}`
              : ''}{extension.version ? ` · v${extension.version}` : ''}{extension.off
              ? `. ${extension.off}`
              : ''}
          </p>
          {#if repo && extension.installed && !extension.off && extension.available !== extension.version}
            <button
              type="button"
              class="app-button-quiet add-update"
              disabled={!!rowBusy}
              onclick={() => update(extension)}
              >{rowBusy === extension.id
                ? 'Updating…'
                : `Update to v${extension.available}`}</button
            >
          {/if}
          {#if errors[`row${extension.id}`] === needsAppMessage}
            <NeedsApp />
          {:else if errors[`row${extension.id}`]}
            <p class="add-error" role="alert">{errors[`row${extension.id}`]}</p>
          {/if}
        </div>
        <Switch
          checked={!extension.off && (repo ? extension.on : picked.has(extension.id))}
          stateText={false}
          disabled={!!extension.off || !!rowBusy}
          aria-labelledby="add-ext-{extension.id}"
          onchange={(next) => toggle(extension, next)}
        />
      </li>
    {:else}
      <li class="add-hint add-none">
        {list.length ? 'No extensions match.' : 'No manga or novel extensions in this repository.'}
      </li>
    {/each}
  </ul>
  {#if filtered.length > shown.length}
    <button
      type="button"
      class="app-button app-button-secondary add-more"
      onclick={() => (showAll = true)}>Show {filtered.length - shown.length} more</button
    >
  {/if}
{/snippet}

{#snippet caution()}
  <p class="add-hint add-gap">
    {standalone
      ? 'Saved on this device only. Its extensions run here, in this browser or app.'
      : 'Saved on this device only. Its extensions run here, in this browser; the server only relays their pages and adds what you fetch to the library.'}
  </p>
  <p class="add-caution">
    Extensions are code from the repository’s authors. They only fetch from their own sites and only
    hand back chapters, pages and details: no access to your library, settings or account.
  </p>
{/snippet}

<svelte:head>
  <title>{repoId ? 'Repository' : 'Add a source'}</title>
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="add-page">
    <a class="app-button-quiet add-back" href="{pagePath}/sources">← Sources</a>
    <h1 class="add-title">{repoId ? (repo?.name ?? 'Repository') : 'Add a source'}</h1>

    {#if !allowed}
      <p class="add-note">
        {'Adding sources needs an account with the "Add books" permission. Ask an admin.'}
      </p>
    {:else if repoId}
      <div class="add-layout">
        <section aria-labelledby="add-repo">
          <SectionHead number={1} title="Repository" id="add-repo" />
          {#if repo}
            <p class="add-address">{repo.url}</p>
            {#if repo.error}
              <p class="add-error">
                Couldn’t read the index again ({repo.error}); showing the last one.
              </p>
            {:else}
              <p class="add-hint">
                {repo.extensions.length} extensions{repo.updates
                  ? `, ${repo.updates} update${repo.updates === 1 ? '' : 's'}`
                  : ''}. Updates install only when you tap them.
              </p>
            {/if}
            {@render caution()}
            <button
              type="button"
              class="app-button app-button-secondary add-remove"
              onclick={forget}>Remove repository</button
            >
          {/if}
          {#if errors.form}<p class="add-error" role="alert">{errors.form}</p>{/if}
        </section>
        {#if repo}
          <section aria-labelledby="add-extensions">
            <SectionHead number={2} title="Extensions" count="{onCount} on" id="add-extensions" />
            {@render extensionList()}
          </section>
        {/if}
      </div>
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
          {:else if kind === 'repo'}
            <SectionHead number={2} title="Repository" id="add-server" />
            <label class="add-label" for="add-repo-url">Repository address</label>
            <input
              id="add-repo-url"
              class="app-input"
              class:add-invalid={errors.url}
              type="url"
              inputmode="url"
              autocomplete="off"
              placeholder="https://example.org/index.json"
              aria-invalid={!!errors.url}
              aria-describedby="add-repo-help"
              bind:value={url}
              oninput={() => (found = undefined)}
            />
            {#if errors.url === needsAppMessage}
              <NeedsApp />
            {:else}
              <p id="add-repo-help" class={errors.url ? 'add-error' : 'add-hint'}>
                {errors.url ??
                  (found
                    ? `Found ${found.length} extensions, ${found.filter((e) => e.lang === 'ja').length} in Japanese; ${runnable.length} can run here.`
                    : 'A Mangayomi index.json (manga or novels).')}
              </p>
            {/if}
            {@render caution()}

            {#if found}
              <div class="add-list">
                <SectionHead
                  number={3}
                  title="Extensions"
                  count="{onCount} on"
                  id="add-extensions"
                />
                {@render extensionList()}
              </div>
            {/if}

            {#if errors.form === needsAppMessage}
              <NeedsApp />
            {:else if errors.form}
              <p class="add-error" role="alert">{errors.form}</p>
            {/if}
            <div class="add-actions">
              <button
                type="submit"
                class="app-button app-button-primary"
                disabled={busy || !url.trim() || (!!found && !picked.size)}
                >{busy
                  ? found
                    ? 'Installing…'
                    : 'Looking up…'
                  : found
                    ? `Add repository with ${picked.size} source${picked.size === 1 ? '' : 's'}`
                    : 'Look up'}</button
              >
              <a class="app-button app-button-secondary" href="{pagePath}/sources">Cancel</a>
            </div>
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

  .add-address {
    margin-top: 0.75rem;
    overflow-wrap: anywhere;
  }

  .add-caution {
    position: relative;
    padding-left: 1.1rem;
    font-size: var(--type-small);
  }

  /* A small square mark, as the study book marks a caution. */
  .add-caution::before {
    position: absolute;
    top: 0.35em;
    left: 0;
    width: 0.5rem;
    height: 0.5rem;
    background: var(--app-warning-color);
    content: '';
  }

  .add-list {
    margin-top: 2rem;
  }

  .add-filter {
    display: flex;
    width: 100%;
    margin-top: 0.75rem;
  }

  .add-filter .app-segment {
    flex: 1;
  }

  .add-extensions {
    border-top: 1px solid var(--border-color);
  }

  .add-extension {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    min-height: 3.5rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .add-japanese {
    margin-top: 0.5rem;
    border-bottom: 2px solid var(--font-color);
  }

  .add-extension-text {
    min-width: 0;
  }

  .add-extension-name {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    font-weight: 700;
  }

  .add-tag {
    padding: 0 0.35rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    font-size: var(--type-label);
    font-weight: 400;
  }

  .add-update {
    margin-top: 0.25rem;
    font-size: var(--type-small);
  }

  .add-none {
    padding: 0.75rem 0;
  }

  .add-more,
  .add-remove {
    width: 100%;
    margin-top: 1rem;
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

    .add-remove {
      width: auto;
    }
  }
</style>
