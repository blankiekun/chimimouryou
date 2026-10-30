<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import SourceCover from '$lib/components/sources/source-cover.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import { browseSite, lookUpWork, searchSites } from '$lib/data/sources/server-sources';
  import type { SourceSearch, SourceSearchWork } from '$lib/data/sources/types';
  import { onMount } from 'svelte';

  /**
   * Search web novels (Sources → Search): a built-in site's search, or its popular and latest
   * works while the box is empty. Runs on the server through the site's adapter (one request,
   * counted against the site's limit; answers cached 10 min). A pasted work link opens the work.
   */

  type Kind = 'search' | 'popular' | 'latest';

  let site = $state(searchSites[0].site);
  let input = $state('');
  let query = $state('');
  let list = $state<'popular' | 'latest'>('popular');
  let result = $state<SourceSearch>();
  let works = $state<SourceSearchWork[]>([]);
  let loading = $state(false);
  let error = $state('');
  // Answers that arrive after the reader moved on are dropped.
  let request = 0;

  const allowed = $derived(!standalone && hasPermission($account$, 'import'));
  const kind = $derived<Kind>(query ? 'search' : list);
  const siteName = $derived(searchSites.find((entry) => entry.site === site)?.name ?? site);
  const domain = $derived(result?.domain ?? (site === 'kakuyomu' ? 'kakuyomu.jp' : 'syosetu.com'));

  async function load(page: number) {
    const mine = ++request;
    loading = true;
    error = '';
    if (page === 1) {
      result = undefined;
      works = [];
    }
    try {
      const found = await browseSite(site, kind, page, query);
      if (mine !== request) return;
      result = found;
      works = page === 1 ? found.works : [...works, ...found.works];
    } catch (problem: any) {
      if (mine === request) error = problem.message;
    } finally {
      if (mine === request) loading = false;
    }
  }

  onMount(() => {
    $libraryTab$ = 'store';
  });

  $effect(() => {
    if (allowed) load(1);
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const text = input.trim();
    if (/^https?:\/\//i.test(text)) {
      loading = true;
      error = '';
      try {
        const work = await lookUpWork(text);
        await goto(`${pagePath}/sources/work?id=${work.id}`);
      } catch (problem: any) {
        error = problem.message;
        loading = false;
      }
      return;
    }
    query = text;
  }

  function ago(ms: number) {
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days < 1) return 'updated today';
    if (days === 1) return 'updated yesterday';
    if (days < 14) return `updated ${days} days ago`;
    if (days < 60) return `updated ${Math.floor(days / 7)} weeks ago`;
    return `updated ${new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  }

  function meta(work: SourceSearchWork) {
    return [
      work.status === 'finished' ? 'Finished' : 'Ongoing',
      `${work.chapters} ch`,
      work.status === 'ongoing' && work.updated && ago(work.updated)
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function summary(found: SourceSearch) {
    const count = `${found.total.toLocaleString('en-US')} work${found.total === 1 ? '' : 's'}`;
    if (kind === 'search') return `${count} · ${found.siteName}'s order: ${found.order}`;
    return kind === 'popular'
      ? `Popular on ${found.siteName} this week`
      : `Latest updates on ${found.siteName}`;
  }
</script>

<svelte:head>
  <title>Search web novels</title>
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="search-page">
    <a class="app-button-quiet search-back" href="{pagePath}/sources">← Sources</a>
    <h1 class="search-title">Search web novels</h1>

    {#if !allowed}
      <p class="search-note">
        {standalone
          ? 'Sources run on a server: the standalone app cannot fetch them yet.'
          : 'Adding web novels needs an account with the "Add books" permission. Ask an admin.'}
      </p>
    {:else}
      <div class="app-segmented search-sites" role="radiogroup" aria-label="Site">
        {#each searchSites as entry (entry.site)}
          <button
            type="button"
            role="radio"
            class="app-segment"
            class:app-segment-selected={site === entry.site}
            aria-checked={site === entry.site}
            onclick={() => (site = entry.site)}>{entry.name}</button
          >
        {/each}
      </div>

      <form class="search-form" role="search" onsubmit={submit}>
        <input
          id="search-input"
          class="app-input"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          aria-label="Search {siteName}, or paste a work's link"
          placeholder="Search {siteName}, or paste a link"
          bind:value={input}
          oninput={() => {
            if (!input.trim()) query = '';
          }}
        />
      </form>

      {#if !query}
        <div class="search-lists">
          <button
            type="button"
            class="app-button-quiet"
            class:search-list-selected={list === 'popular'}
            aria-pressed={list === 'popular'}
            onclick={() => (list = 'popular')}>Popular</button
          >
          <button
            type="button"
            class="app-button-quiet"
            class:search-list-selected={list === 'latest'}
            aria-pressed={list === 'latest'}
            onclick={() => (list = 'latest')}>Latest</button
          >
        </div>
      {/if}

      <p class="search-meta" role="status">
        {#if error}
          <span class="search-error">{error}</span>
        {:else if loading}
          Waiting for {domain}…
        {:else if result}
          {summary(result)}
        {/if}
      </p>

      {#if works.length}
        <ul class="search-rows">
          {#each works as work (work.workKey)}
            <li>
              <a
                class="search-row"
                href="{pagePath}/sources/work?site={site}&key={encodeURIComponent(work.workKey)}"
              >
                <SourceCover title={work.title} />
                <div class="search-row-text">
                  <p class="search-row-title" lang="ja">{work.title}</p>
                  <p class="search-row-meta" lang="ja">{work.authors}</p>
                  <p class="search-row-meta">{meta(work)}</p>
                  {#if work.following}
                    <span class="search-tag search-tag-following">Following</span>
                  {:else if work.inLibrary}
                    <span class="search-tag">In library</span>
                  {/if}
                </div>
              </a>
            </li>
          {/each}
        </ul>
      {:else if result && !loading && !error}
        <p class="search-note">
          {query ? `Nothing on ${result.siteName} for “${query}”.` : 'Nothing here right now.'}
        </p>
      {/if}

      {#if result?.more && works.length}
        <div class="search-more">
          <button
            type="button"
            class="app-button app-button-secondary"
            disabled={loading}
            onclick={() => load((result?.page ?? 1) + 1)}
            >{loading ? 'Loading…' : 'Show 20 more'}</button
          >
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  .search-page {
    max-width: 48rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  .search-back {
    display: inline-block;
    margin-bottom: 1rem;
  }

  .search-title {
    margin-bottom: 1.5rem;
    font-size: var(--type-h1);
    line-height: 1.2;
  }

  .search-note {
    margin-top: 1.5rem;
    color: var(--app-muted-fg);
  }

  .search-sites {
    display: flex;
    width: 100%;
  }

  .search-sites .app-segment {
    flex: 1;
  }

  .search-form {
    margin-top: 1rem;
  }

  .search-form .app-input {
    width: 100%;
    height: 2.75rem;
  }

  .search-lists {
    display: flex;
    gap: 1.25rem;
    margin-top: 0.75rem;
  }

  .search-lists .app-button-quiet {
    padding: 0.25rem 0;
    border-bottom: 2px solid transparent;
    color: var(--app-muted-fg);
  }

  .search-lists .search-list-selected {
    border-bottom-color: var(--accent-strong-color);
    color: var(--font-color);
  }

  .search-meta {
    min-height: 1.5rem;
    margin-top: 0.6rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .search-error {
    color: var(--app-danger-color);
  }

  .search-rows {
    margin-top: 0.75rem;
    border-top: 2px solid var(--font-color);
  }

  .search-rows li {
    border-bottom: 1px solid var(--border-color);
  }

  .search-row {
    display: flex;
    gap: 1rem;
    padding: 0.9rem 0;
    color: inherit;
  }

  .search-row:hover .search-row-title {
    color: var(--accent-strong-color);
  }

  .search-row:focus-visible {
    outline: 2px solid var(--accent-strong-color);
    outline-offset: 2px;
  }

  .search-row-text {
    min-width: 0;
  }

  .search-row-title {
    font-weight: 700;
    line-height: 1.6;
  }

  .search-row-meta {
    margin-top: 0.15rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .search-tag {
    display: inline-block;
    margin-top: 0.4rem;
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    color: var(--font-color);
    font-size: var(--type-label);
  }

  .search-tag-following {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-weight: 700;
  }

  .search-more {
    display: flex;
    justify-content: center;
    margin-top: 1.5rem;
  }

  @media (min-width: 768px) {
    .search-page {
      padding: 6rem 2.5rem 4rem;
    }

    .search-sites {
      width: auto;
      max-width: 24rem;
    }
  }
</style>
