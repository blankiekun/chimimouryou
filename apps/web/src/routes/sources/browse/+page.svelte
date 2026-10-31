<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import NeedsApp from '$lib/components/sources/needs-app.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import { page } from '$lib/data/page-store';
  import {
    browseExtension,
    browseServer,
    extensionImageSrc,
    extensionSites,
    listServers,
    removeServer,
    searchSites,
    serverImageSrc
  } from '$lib/data/sources/server-sources';
  import type {
    SourceExtensionFeed,
    SourceServer,
    SourceServerEntry,
    SourceServerFeed
  } from '$lib/data/sources/types';
  import { needsAppMessage } from '$lib/data/sources/transport';
  import { onMount } from 'svelte';

  /**
   * Browse (board 3): the reader's servers (OPDS catalogs, Suwayomi) beside the web novel sites.
   * A server shows its feed's own sections in place of Popular/Latest; a series opens its work
   * page. /sources/browse?server=N&section=<path>&q=<search>, so Back walks up the catalog.
   * An extension (board 3b, ?ext=<site>&mode=popular|latest|search&q=) runs on this device: its
   * Popular, Latest and Search, cover cards to its work pages.
   */

  let servers = $state<SourceServer[]>();
  let feed = $state<SourceServerFeed>();
  let entries = $state<SourceServerEntry[]>([]);
  let loading = $state(false);
  let error = $state('');
  let input = $state('');
  let failedCovers = $state<Set<string>>(new Set());
  let request = 0;
  let exts = $state<{ site: string; name: string; kind: 'manga' | 'novel' }[]>();
  let extFeed = $state<SourceExtensionFeed>();
  let extWorks = $state<SourceExtensionFeed['works']>([]);

  const allowed = $derived(standalone || hasPermission($account$, 'import'));
  const params = $derived(browser ? $page.url.searchParams : new URLSearchParams());
  // No server picked and none added: the first extension, if any.
  const extSite = $derived(
    params.get('ext') ||
      (!params.get('server') && servers && !servers.length ? (exts?.[0]?.site ?? '') : '')
  );
  const ext = $derived(exts?.find((entry) => entry.site === extSite));
  const mode = $derived.by(() => {
    const value = params.get('mode');
    return value === 'latest' || value === 'search' ? value : 'popular';
  });
  const serverId = $derived(extSite ? 0 : Number(params.get('server')) || servers?.[0]?.id || 0);
  const section = $derived(params.get('section') ?? '');
  const query = $derived(params.get('q') ?? '');
  const server = $derived(servers?.find((entry) => entry.id === serverId));

  onMount(() => {
    $libraryTab$ = 'store';
  });

  $effect(() => {
    if (!allowed) return;
    listServers().then(
      (found) => (servers = found.servers),
      (problem) => (error = problem.message)
    );
    extensionSites().then(
      (found) => (exts = found),
      () => (exts = [])
    );
  });

  $effect(() => {
    if (!ext) return;
    input = query;
    if (mode === 'search' && !query) {
      extFeed = undefined;
      extWorks = [];
      error = '';
      return;
    }
    loadExt(ext.site, mode, 1, query);
  });

  async function loadExt(site: string, kind: typeof mode, pageNumber: number, q: string) {
    const mine = ++request;
    loading = true;
    error = '';
    if (pageNumber === 1) {
      extFeed = undefined;
      extWorks = [];
    }
    try {
      const found = await browseExtension(site, kind, pageNumber, q);
      if (mine !== request) return;
      extFeed = found;
      extWorks = pageNumber === 1 ? found.works : [...extWorks, ...found.works];
    } catch (problem: any) {
      if (mine === request) error = problem.message;
    } finally {
      if (mine === request) loading = false;
    }
  }

  function extLink(site: string, extra: Record<string, string> = {}) {
    return `${pagePath}/sources/browse?${new URLSearchParams({ ext: site, ...extra })}`;
  }

  function extSearch(event: SubmitEvent) {
    event.preventDefault();
    if (ext) goto(extLink(ext.site, { mode: 'search', ...(input.trim() && { q: input.trim() }) }));
  }

  $effect(() => {
    if (!server) return;
    input = query;
    load(server.id, section, query);
  });

  async function load(id: number, path: string, q: string, more = false) {
    const mine = ++request;
    loading = true;
    error = '';
    if (!more) {
      feed = undefined;
      entries = [];
    }
    try {
      const found = await browseServer(id, path, q);
      if (mine !== request) return;
      feed = found;
      entries = more ? [...entries, ...found.entries] : found.entries;
    } catch (problem: any) {
      if (mine === request) error = problem.message;
    } finally {
      if (mine === request) loading = false;
    }
  }

  function link(id: number, extra: Record<string, string> = {}) {
    return `${pagePath}/sources/browse?${new URLSearchParams({ server: String(id), ...extra })}`;
  }

  function entryLink(entry: SourceServerEntry) {
    if (entry.kind === 'section') return link(serverId, { section: entry.href ?? '' });
    return `${pagePath}/sources/work?${new URLSearchParams({
      site: `opds:${serverId}`,
      key: entry.workKey ?? ''
    })}`;
  }

  function search(event: SubmitEvent) {
    event.preventDefault();
    goto(link(serverId, input.trim() ? { q: input.trim() } : {}));
  }

  async function remove() {
    if (!server) return;
    if (
      !window.confirm(
        `Remove ${server.name}? Following its works stops; their volumes stay in the library.`
      )
    )
      return;
    try {
      await removeServer(server.id);
      servers = servers?.filter((entry) => entry.id !== server.id);
      await goto(`${pagePath}/sources/browse`);
    } catch (problem: any) {
      error = problem.message;
    }
  }

  function meta(entry: SourceServerEntry) {
    if (entry.kind === 'section') return 'Section';
    return entry.authors || (entry.kind === 'work' ? 'Series' : 'Book');
  }
</script>

<svelte:head>
  <title>Browse</title>
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="browse-page">
    <a class="app-button-quiet browse-back" href="{pagePath}/sources">← Sources</a>
    <h1 class="browse-title">Browse</h1>

    {#if !allowed}
      <p class="browse-note">
        {'Browsing sources needs an account with the "Add books" permission. Ask an admin.'}
      </p>
    {:else}
      <div class="browse-layout">
        <nav class="browse-nav" aria-label="Sources">
          <p class="browse-group">Web novel sites</p>
          <ul>
            {#each searchSites as entry (entry.site)}
              <li><a class="browse-source" href="{pagePath}/sources/search">{entry.name}</a></li>
            {/each}
          </ul>
          <p class="browse-group">Servers</p>
          <ul>
            {#each servers ?? [] as entry (entry.id)}
              <li>
                <a
                  class="browse-source"
                  class:browse-source-selected={entry.id === serverId}
                  aria-current={entry.id === serverId ? 'page' : undefined}
                  href={link(entry.id)}
                >
                  <span>{entry.name}</span>
                  <span class="browse-source-type"
                    >{entry.type === 'suwayomi' ? 'Suwayomi' : 'OPDS'}</span
                  >
                </a>
              </li>
            {/each}
          </ul>
          {#if exts?.length}
            <p class="browse-group">Extensions · this device</p>
            <ul>
              {#each exts as entry (entry.site)}
                <li>
                  <a
                    class="browse-source"
                    class:browse-source-selected={entry.site === extSite}
                    aria-current={entry.site === extSite ? 'page' : undefined}
                    href={extLink(entry.site)}
                  >
                    <span lang="ja">{entry.name}</span>
                    <span class="browse-source-type"
                      >{entry.kind === 'manga' ? 'Manga' : 'Novels'}</span
                    >
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
          <a class="app-button-quiet browse-add" href="{pagePath}/sources/add">Add a source</a>
        </nav>

        <section class="browse-main" aria-labelledby="browse-feed">
          {#if ext}
            <div class="browse-head">
              <div>
                <h2 id="browse-feed" class="browse-feed-title" lang="ja">
                  {query ? `“${query}”` : ext.name}
                </h2>
                <p class="browse-meta">
                  {ext.kind === 'manga' ? 'Manga' : 'Novels'} · extension, this device
                </p>
              </div>
            </div>
            <div class="app-segmented browse-modes" role="tablist" aria-label="List">
              {#each [['popular', 'Popular'], ['latest', 'Latest'], ['search', 'Search']] as const as [value, text] (value)}
                <a
                  role="tab"
                  class="app-segment"
                  class:app-segment-selected={mode === value}
                  aria-selected={mode === value}
                  href={extLink(ext.site, value === 'popular' ? {} : { mode: value })}>{text}</a
                >
              {/each}
            </div>
            {#if mode === 'search'}
              <form class="browse-search" role="search" onsubmit={extSearch}>
                <input
                  class="app-input"
                  type="search"
                  enterkeyhint="search"
                  autocomplete="off"
                  aria-label="Search {ext.name}"
                  placeholder="Search {ext.name}"
                  bind:value={input}
                />
              </form>
            {/if}
            <p class="browse-meta browse-status" role="status">
              {#if error === needsAppMessage}
                <NeedsApp />
              {:else if error}
                <span class="browse-error">{error}</span>
              {:else if loading && !extWorks.length}
                Asking {ext.name}…
              {:else if extFeed && !extWorks.length}
                {query ? `Nothing on ${ext.name} for “${query}”.` : 'Nothing here.'}
              {/if}
            </p>
            {#if extWorks.length}
              <ul class="browse-grid">
                {#each extWorks as work, index (`${index}-${work.workKey}`)}
                  <li>
                    <a
                      class="browse-card"
                      href="{pagePath}/sources/work?{new URLSearchParams({
                        site: ext.site,
                        key: work.workKey
                      })}"
                    >
                      <span class="browse-cover" aria-hidden="true">
                        {#if work.cover && !failedCovers.has(work.cover)}
                          {#await extensionImageSrc(ext.site, work.cover) then src}
                            <img
                              {src}
                              alt=""
                              loading="lazy"
                              onerror={() =>
                                (failedCovers = new Set([...failedCovers, work.cover]))}
                            />
                          {:catch}
                            <span class="browse-cover-title" lang="ja">{work.title}</span>
                          {/await}
                        {:else}
                          <span class="browse-cover-title" lang="ja">{work.title}</span>
                        {/if}
                      </span>
                      <span class="browse-card-title" lang="ja">{work.title}</span>
                      <span class="browse-meta">{ext.kind === 'manga' ? 'Manga' : 'Novel'}</span>
                      {#if work.following}
                        <span class="browse-tag browse-tag-following">Following</span>
                      {:else if work.inLibrary}
                        <span class="browse-tag"
                          >{standalone ? 'On this device' : 'In library'}</span
                        >
                      {/if}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if extFeed?.more && extWorks.length}
              <div class="browse-more">
                <button
                  type="button"
                  class="app-button app-button-secondary"
                  disabled={loading}
                  onclick={() => ext && extFeed && loadExt(ext.site, mode, extFeed.page + 1, query)}
                  >{loading ? 'Loading…' : 'Load more'}</button
                >
              </div>
            {/if}
          {:else if servers && !servers.length && exts}
            <p class="browse-note">
              Nothing to browse yet. Add a Suwayomi server, an OPDS catalog (Komga, Kavita,
              Calibre-web) or an extension repository to browse it here.
            </p>
            <a class="app-button app-button-primary browse-first" href="{pagePath}/sources/add"
              >Add a source</a
            >
          {:else if server}
            <div class="browse-head">
              <div>
                <h2 id="browse-feed" class="browse-feed-title" lang="ja">
                  {query ? `“${query}”` : feed?.title || server.name}
                </h2>
                <p class="browse-meta">
                  {server.name}{#if section || query}{' · '}<a
                      class="app-button-quiet"
                      href={link(server.id)}>Catalog start</a
                    >{/if}
                </p>
              </div>
              <button type="button" class="app-button-quiet browse-remove" onclick={remove}
                >Remove source</button
              >
            </div>

            {#if feed?.search || query}
              <form class="browse-search" role="search" onsubmit={search}>
                <input
                  class="app-input"
                  type="search"
                  enterkeyhint="search"
                  autocomplete="off"
                  aria-label="Search {server.name}"
                  placeholder="Search {server.name}"
                  bind:value={input}
                />
              </form>
            {/if}

            <p class="browse-meta browse-status" role="status">
              {#if error === needsAppMessage}
                <NeedsApp />
              {:else if error}
                <span class="browse-error">{error}</span>
              {:else if loading && !entries.length}
                Asking {server.name}…
              {:else if feed && !entries.length}
                {query ? `Nothing on ${server.name} for “${query}”.` : 'Nothing here.'}
              {/if}
            </p>

            {#if entries.length}
              <ul class="browse-grid">
                {#each entries as entry, index (`${index}-${entry.href ?? entry.workKey}`)}
                  <li>
                    <a class="browse-card" href={entryLink(entry)}>
                      <span class="browse-cover" aria-hidden="true">
                        {#if entry.cover && !failedCovers.has(entry.cover)}
                          {#await serverImageSrc(serverId, entry.cover) then src}
                            <img
                              {src}
                              alt=""
                              loading="lazy"
                              onerror={() =>
                                (failedCovers = new Set([...failedCovers, entry.cover ?? '']))}
                            />
                          {:catch}
                            <span class="browse-cover-title" lang="ja">{entry.title}</span>
                          {/await}
                        {:else}
                          <span class="browse-cover-title" lang="ja">{entry.title}</span>
                        {/if}
                      </span>
                      <span class="browse-card-title" lang="ja">{entry.title}</span>
                      <span class="browse-meta" lang="ja">{meta(entry)}</span>
                      {#if entry.following}
                        <span class="browse-tag browse-tag-following">Following</span>
                      {:else if entry.inLibrary}
                        <span class="browse-tag"
                          >{standalone ? 'On this device' : 'In library'}</span
                        >
                      {/if}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if feed?.next && entries.length}
              <div class="browse-more">
                <button
                  type="button"
                  class="app-button app-button-secondary"
                  disabled={loading}
                  onclick={() => load(serverId, feed?.next ?? '', '', true)}
                  >{loading ? 'Loading…' : 'Load more'}</button
                >
              </div>
            {/if}
          {:else if error}
            <p class="browse-error" role="alert">{error}</p>
          {/if}
        </section>
      </div>
    {/if}
  </main>
</div>

<style>
  .browse-page {
    max-width: 75rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  .browse-back {
    display: inline-block;
    margin-bottom: 1rem;
  }

  .browse-title {
    margin-bottom: 1.5rem;
    font-size: var(--type-h1);
    line-height: 1.2;
  }

  .browse-note {
    color: var(--app-muted-fg);
  }

  .browse-layout {
    display: grid;
    gap: 1.5rem;
  }

  .browse-nav ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
  }

  .browse-group {
    margin: 0.75rem 0 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .browse-source {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding: 0.4rem 0.6rem;
    border-radius: 2px;
    color: var(--font-color);
  }

  .browse-source:hover {
    color: var(--accent-strong-color);
  }

  .browse-source-selected {
    background: var(--app-spot-tint);
    font-weight: 700;
  }

  .browse-source-type {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 400;
  }

  .browse-add {
    display: inline-block;
    margin-top: 0.75rem;
  }

  .browse-main {
    min-width: 0;
  }

  .browse-first {
    display: inline-block;
    margin-top: 1rem;
  }

  .browse-head {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
  }

  .browse-feed-title {
    font-size: var(--type-h2);
    font-weight: 700;
    line-height: 1.4;
  }

  .browse-remove {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .browse-meta {
    display: block;
    margin-top: 0.15rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .browse-status {
    min-height: 1.5rem;
    margin-top: 0.75rem;
  }

  .browse-error {
    color: var(--app-danger-color);
  }

  .browse-search {
    margin-top: 1rem;
  }

  .browse-modes {
    display: flex;
    margin-top: 1rem;
  }

  .browse-modes .app-segment {
    flex: 1;
    text-align: center;
  }

  @media (min-width: 768px) {
    .browse-modes {
      display: inline-flex;
    }

    .browse-modes .app-segment {
      min-width: 7rem;
    }
  }

  .browse-search .app-input {
    width: 100%;
    height: 2.75rem;
  }

  .browse-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: 1.5rem 1rem;
    margin-top: 0.5rem;
  }

  .browse-card {
    display: flex;
    flex-direction: column;
    color: inherit;
  }

  .browse-card:hover .browse-card-title {
    color: var(--accent-strong-color);
  }

  .browse-card:focus-visible {
    outline: 2px solid var(--accent-strong-color);
    outline-offset: 2px;
  }

  /* One cover size on one baseline, like the shelves; the title card until a cover arrives. */
  .browse-cover {
    display: block;
    aspect-ratio: 5 / 7;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--surface-color);
  }

  .browse-cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .browse-cover-title {
    display: -webkit-box;
    margin: 0.5rem;
    padding-bottom: 0.4rem;
    overflow: hidden;
    border-bottom: 2px solid var(--font-color);
    font-size: var(--type-small);
    font-weight: 700;
    line-height: 1.5;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
  }

  .browse-card-title {
    display: -webkit-box;
    margin-top: 0.5rem;
    overflow: hidden;
    font-size: var(--type-small);
    font-weight: 700;
    line-height: 1.5;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .browse-tag {
    align-self: flex-start;
    margin-top: 0.4rem;
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    font-size: var(--type-label);
  }

  .browse-tag-following {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-weight: 700;
  }

  .browse-more {
    display: flex;
    justify-content: center;
    margin-top: 1.5rem;
  }

  @media (min-width: 768px) {
    .browse-page {
      padding: 6rem 2.5rem 4rem;
    }

    .browse-layout {
      grid-template-columns: 15rem minmax(0, 1fr);
      gap: 3.5rem;
    }

    .browse-nav ul {
      display: block;
    }

    .browse-grid {
      grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    }
  }
</style>
