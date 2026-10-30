<script lang="ts">
  import { faChevronDown, faChevronRight, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
  import {
    deleteSavedRecap,
    getSavedRecaps,
    planRecap,
    recapsChanged$,
    writeRecap,
    type RecapPlan,
    type SavedRecap
  } from '$lib/data/recap';
  import { extrasSyncError$, syncExtras } from '$lib/data/extras-sync';
  import { chapterLabelAt, type SearchIndex } from '$lib/functions/book-text/book-search';
  import { onDestroy, onMount } from 'svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { modelShortName } from '$lib/data/ai-settings';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';
  import { renderBasicMarkdown } from '$lib/functions/basic-markdown';

  export let title: string;
  export let getIndex: () => Promise<SearchIndex>;
  export let sections: Section[];
  export let position: number;
  export let bookCharacters: number;
  /** The tab is showing (it stays mounted while hidden) */
  export let active = true;

  /** A saved recap this close to the position is shown instead of writing a new one. */
  const reuseDistance = 2000;

  let index: SearchIndex | undefined;
  let plan: RecapPlan | undefined;
  let saved: SavedRecap[] = [];
  let openRecap: number | undefined;
  let progress = '';
  let recap = '';
  let error = '';
  let running = false;
  let abortController = new AbortController();

  const percent = (count: number) =>
    bookCharacters ? `${((count / bookCharacters) * 100).toFixed(1)}%` : '';

  // Recaps from other devices arrive through sync.
  const subscription = recapsChanged$.subscribe((changed) => {
    if (changed.title === title) {
      saved = [...(changed.saved ?? [])].sort((a, b) => a.position - b.position);
    }
  });

  onMount(async () => {
    try {
      await syncExtras('recaps', title);
      saved = await getSavedRecaps(title);
      index = await getIndex();
      plan = await planRecap(title, index, sections, position, bookCharacters);

      const recent = [...saved]
        .reverse()
        .find((r) => r.position <= position && position - r.position <= reuseDistance);

      // Show the latest saved recap near here; writing a new one is up to the reader.
      if (recent) {
        openRecap = recent.created;
      }
    } catch (e: any) {
      error = e.message;
    }
  });

  onDestroy(() => {
    abortController.abort();
    subscription.unsubscribe();
  });

  // Follow the position, so a recap written later covers what has been read since.
  $: if (active && index && !running) {
    planRecap(title, index, sections, position, bookCharacters)
      .then((updated) => (plan = updated))
      .catch(() => {});
  }

  async function start() {
    if (!index || !plan || running) {
      return;
    }

    running = true;
    error = '';
    recap = '';
    openRecap = undefined;

    try {
      const written = await writeRecap(
        title,
        index,
        plan,
        position,
        (message) => (progress = message),
        (text) => (recap = text),
        abortController.signal
      );

      progress = '';
      recap = '';
      saved = await getSavedRecaps(title);
      openRecap = written.created;
    } catch (e: any) {
      if (!abortController.signal.aborted) {
        error = e.message;
      }
    } finally {
      running = false;
    }
  }

  async function remove(created: number) {
    await deleteSavedRecap(title, created);
    saved = await getSavedRecaps(title);
  }
</script>

<div class="recap panel-body">
  <SectionHead number={1} title={$t$('reader.recap')} />
  {#if error}
    <p class="text-panel-danger">{error}</p>
  {/if}
  {#if $extrasSyncError$.recaps}
    <p class="text-panel-danger">{$extrasSyncError$.recaps}</p>
  {/if}

  {#if !plan && !error}
    <p class="panel-note flex items-center gap-2">
      <Fa icon={faSpinner} spin />
      {$t$('reader.preparing')}
    </p>
  {:else if plan && !running}
    <p>
      {$t$('reader.recapIntro', { count: position.toLocaleString(), percent: percent(position) })}
    </p>
    {#if plan.missing.length}
      <p class="panel-note">
        {$t$(plan.missing.length === 1 ? 'reader.recapMissingOne' : 'reader.recapMissing', {
          count: plan.missing.length,
          k: Math.round(plan.missingCharacters / 1000),
          model: modelShortName(plan.model)
        })}
      </p>
    {/if}
    <button class="app-button app-button-primary self-start" on:click={start}>
      {$t$('reader.writeRecap')}
    </button>
  {/if}

  {#if progress}
    <p class="panel-note flex items-center gap-2">
      <Fa icon={faSpinner} spin />
      {progress}
    </p>
  {/if}

  {#if recap}
    <div class="recap-text">{@html renderBasicMarkdown(recap)}</div>
  {/if}

  {#if saved.length}
    <div class="recap-saved">
      <h3 class="recap-saved-head">{$t$('reader.savedRecaps')} · {saved.length}</h3>
      <ul class="recap-list">
        {#each [...saved].reverse() as item (item.created)}
          {@const ahead = item.position > position}
          <li>
            <div class="recap-row">
              <button
                class="recap-toggle"
                aria-expanded={openRecap === item.created}
                on:click={() => (openRecap = openRecap === item.created ? undefined : item.created)}
              >
                <Fa icon={openRecap === item.created ? faChevronDown : faChevronRight} fw />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-bold" lang="ja">
                    {chapterLabelAt(sections, item.position) || $t$('reader.recapFallback')} · {percent(
                      item.position
                    )}
                  </span>
                  <span class="panel-note block">
                    {$t$('reader.recapMeta', {
                      count: item.position.toLocaleString(),
                      date: new Date(item.created).toLocaleDateString()
                    })}{ahead ? ` · ${$t$('reader.recapAhead')}` : ''}
                  </span>
                </span>
              </button>
              <button class="app-button app-button-quiet" on:click={() => remove(item.created)}>
                {$t$('reader.delete')}
              </button>
            </div>
            {#if openRecap === item.created}
              <div class="recap-text pb-4">{@html renderBasicMarkdown(item.text)}</div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .recap {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding-top: 1rem;
    padding-bottom: 1.5rem;
    line-height: 1.7;
  }

  .recap-text {
    white-space: pre-wrap;
    line-height: 1.8;
  }

  .recap-saved {
    margin-top: 0.75rem;
  }

  .recap-saved-head {
    color: var(--muted);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .recap-list {
    margin-top: 0.5rem;
    border-top: 2px solid var(--reader-panel-fg);
  }

  .recap-list > li {
    border-bottom: 1px solid var(--rule);
  }

  .recap-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0;
  }

  .recap-toggle {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.5rem;
    text-align: left;
    line-height: 1.5;
  }
</style>
