<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import AiLanguageToggle from '$lib/components/ai-language-toggle.svelte';
  import { lorebookAutoInterval$, modelShortName } from '$lib/data/ai-settings';
  import {
    clearLorebook,
    copyLorebookTo,
    getLorebook,
    laterInSeries,
    isLorebookUpdating,
    loreCategories,
    lorebookChanged$,
    lorebookProgress$,
    minUpdateCharacters,
    saveLoreEntries,
    stopLorebookUpdate,
    toSillyTavern,
    updateLorebook,
    type LoreCategory,
    type Lorebook
  } from '$lib/data/lorebook';
  import { loadCalibreCatalog, type CalibreBook } from '$lib/data/calibre';
  import {
    enableExtrasSync,
    extrasSyncError$,
    extrasSyncSource,
    syncExtras
  } from '$lib/data/extras-sync';
  import { homeBookTitles$ } from '$lib/data/library-home';
  import { recapModel } from '$lib/data/recap';
  import type { SearchIndex } from '$lib/functions/book-text/book-search';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import { onDestroy, onMount } from 'svelte';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let title: string;
  export let getIndex: () => Promise<SearchIndex>;
  export let position: number;

  // Read when the tab opens; the model is set in Settings → AI.
  const model = recapModel();

  $: categoryLabels = (category: LoreCategory) => $t$(`reader.lore.${category}`);

  let lorebook: Lorebook | undefined;
  let progress = '';
  let error = '';
  let running = false;
  let category: LoreCategory | '' = '';
  let filter = '';
  let openEntry = '';
  /** Later books of the series, once "Next book" is pressed */
  let sendTargets: CalibreBook[] | undefined;
  let sendTarget = '';
  let sendMessage = '';

  // Updates run in lorebook.ts, so they go on when this tab or the panel closes.
  const subscriptions = [
    lorebookChanged$.subscribe((changed) => {
      if (changed.title === title) {
        lorebook = changed;
        running = isLorebookUpdating(title);
      }
    }),
    lorebookProgress$.subscribe((state) => {
      if (state.title === title) {
        progress = state.message;
        error = state.error;
        running = isLorebookUpdating(title);
      }
    })
  ];

  onMount(async () => {
    try {
      await syncExtras('lorebook', title);
      lorebook = await getLorebook(title);
    } catch (e: any) {
      error = e.message;
    }
    running = isLorebookUpdating(title);
  });

  onDestroy(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));

  $: pending = lorebook ? Math.max(0, position - lorebook.processedUpTo) : 0;
  // Entries first met after the position would be spoilers when reading an earlier part again.
  $: visible = (lorebook?.entries ?? []).filter(
    (entry) =>
      (!!entry.fromBook || entry.firstSeen < position) &&
      (!category || entry.category === category) &&
      (!filter ||
        [entry.name, entry.reading, entry.content, ...entry.keys].some((text) =>
          text.toLowerCase().includes(filter.toLowerCase())
        ))
  );
  $: counts = (lorebook?.entries ?? []).reduce<Record<string, number>>((acc, entry) => {
    acc[entry.category] = (acc[entry.category] ?? 0) + 1;
    return acc;
  }, {});

  async function update() {
    if (running) {
      return;
    }

    running = true;
    error = '';

    try {
      await updateLorebook(title, await getIndex(), position);
    } catch (e: any) {
      // Update errors arrive through lorebookProgress$; this catches the index failing.
      if (!isLorebookUpdating(title) && !error) {
        error = e.message;
      }
      running = isLorebookUpdating(title);
    }
  }

  async function showSendTargets() {
    if (sendTargets) {
      sendTargets = undefined;
      return;
    }

    sendMessage = '';

    try {
      sendTargets = laterInSeries(await loadCalibreCatalog(), title, $homeBookTitles$);
      sendTarget = sendTargets[0]?.title ?? '';
      if (!sendTargets.length) {
        sendMessage = tr('reader.loreNoLater');
      }
    } catch (e: any) {
      sendTargets = [];
      sendMessage = e.message;
    }
  }

  async function send() {
    if (!sendTarget) {
      return;
    }

    const added = await copyLorebookTo(title, sendTarget);

    // The next book is from Calibre too, so its lorebook syncs.
    if (extrasSyncSource(title)) {
      enableExtrasSync(sendTarget, extrasSyncSource(title));
      syncExtras('lorebook', sendTarget);
    }

    sendMessage = tr(added === 1 ? 'reader.loreCopiedOne' : 'reader.loreCopied', {
      count: added,
      title: sendTarget
    });
    sendTargets = undefined;
  }

  function editContent(id: string, content: string) {
    if (!lorebook) {
      return;
    }

    saveLoreEntries(
      title,
      lorebook.entries.map((entry) => (entry.id === id ? { ...entry, content } : entry))
    );
  }

  function removeEntry(id: string) {
    if (lorebook) {
      saveLoreEntries(
        title,
        lorebook.entries.filter((entry) => entry.id !== id)
      );
    }
  }

  async function clearAll() {
    if (confirm(tr('reader.loreClearConfirm'))) {
      await clearLorebook(title);
    }
  }

  function exportJson() {
    if (lorebook) {
      downloadBlob(
        new Blob([JSON.stringify(toSillyTavern(lorebook), null, 2)], { type: 'application/json' }),
        `${title.replace(/[\\/:*?"<>|]/g, '_')} - lorebook.json`
      );
    }
  }
</script>

<div class="panel-meta">
  <span class="panel-meta-text" title={model}>{modelShortName(model)}</span>
  <AiLanguageToggle compact />
</div>
<div class="flex min-h-0 flex-1 flex-col">
  <div class="lore-top panel-body">
    {#if lorebook}
      <p class="panel-note">
        {$t$('reader.loreReadUpTo', { count: lorebook.processedUpTo.toLocaleString() })}
        {$lorebookAutoInterval$
          ? $t$('reader.loreAuto', { count: $lorebookAutoInterval$.toLocaleString() })
          : $t$('reader.loreAutoOff')}
      </p>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          class="app-button app-button-primary"
          disabled={running || pending < minUpdateCharacters}
          title={$t$('reader.loreUpdateTitle', {
            count: pending.toLocaleString(),
            model: modelShortName(model)
          })}
          on:click={update}
        >
          {#if running}<Fa icon={faSpinner} spin /> {$t$('reader.loreUpdating')}{:else}{$t$(
              'reader.loreUpdate',
              { k: Math.round(pending / 1000) }
            )}{/if}
        </button>
        {#if running}
          <button
            class="app-button"
            title={$t$('reader.loreStopTitle')}
            on:click={() => stopLorebookUpdate(title)}
          >
            {$t$('reader.stop')}
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-x-4">
        <button
          class="app-button app-button-quiet"
          title={$t$('reader.loreSend')}
          disabled={!lorebook.entries.length}
          on:click={showSendTargets}
        >
          {$t$('reader.loreSendShort')}
        </button>
        <button
          class="app-button app-button-quiet"
          title={$t$('reader.loreExport')}
          disabled={!lorebook.entries.length}
          on:click={exportJson}
        >
          {$t$('reader.loreExportShort')}
        </button>
        <button
          class="app-button app-button-quiet"
          title={$t$('reader.loreClear')}
          disabled={running || !lorebook.entries.length}
          on:click={clearAll}
        >
          {$t$('reader.loreClearShort')}
        </button>
      </div>
      {#if sendTargets?.length}
        <div class="flex items-center gap-2">
          <select class="app-input min-w-0 flex-1" bind:value={sendTarget}>
            {#each sendTargets as book (book.title)}
              <option value={book.title}>
                {book.seriesIndex ?? '?'} · {book.title}{$homeBookTitles$.includes(book.title)
                  ? ` (${$t$('nav.home')})`
                  : ''}
              </option>
            {/each}
          </select>
          <button class="app-button" on:click={send}>
            {$t$('reader.loreCopy')}
          </button>
        </div>
      {/if}
      {#if sendMessage}<p class="panel-note">{sendMessage}</p>{/if}
      {#if progress}<p class="panel-note">{progress}</p>{/if}
    {/if}
    {#if error}<p class="text-panel-danger">{error}</p>{/if}
    {#if $extrasSyncError$.lorebook}<p class="text-panel-danger">
        {$extrasSyncError$.lorebook}
      </p>{/if}

    {#if lorebook?.entries.length}
      <div class="flex gap-2">
        <select
          class="app-input lore-category"
          aria-label={$t$('reader.loreCategory')}
          bind:value={category}
        >
          <option value="">{$t$('reader.all')} {lorebook.entries.length}</option>
          {#each loreCategories as option}
            {#if counts[option]}
              <option value={option}>{categoryLabels(option)} {counts[option]}</option>
            {/if}
          {/each}
        </select>
        <input
          class="app-input min-w-0 flex-1"
          type="search"
          placeholder={$t$('reader.loreFilter')}
          bind:value={filter}
        />
      </div>
    {/if}
  </div>

  <div class="panel-body flex-1 overflow-y-auto pb-6">
    {#if lorebook && !lorebook.entries.length}
      <p class="panel-note py-6">
        {$t$('reader.loreEmpty')}
      </p>
    {:else if visible.length}
      <ul class="lore-list">
        {#each visible as entry (entry.id)}
          <li>
            <button
              class="lore-entry"
              aria-expanded={openEntry === entry.id}
              on:click={() => (openEntry = openEntry === entry.id ? '' : entry.id)}
            >
              <span class="font-bold" lang="ja">{entry.name}</span>
              {#if entry.reading && entry.reading !== entry.name}
                <span class="panel-note" lang="ja">{entry.reading}</span>
              {/if}
              <span class="panel-note ml-1">{categoryLabels(entry.category)}</span>
              {#if openEntry !== entry.id}
                <span class="lore-preview" lang="ja">{entry.content}</span>
              {/if}
            </button>
            {#if openEntry === entry.id}
              <textarea
                class="app-input w-full"
                rows="5"
                lang="ja"
                value={entry.content}
                on:change={(e) => editContent(entry.id, e.currentTarget.value)}
              />
              <div class="panel-note flex items-center gap-3 pb-2">
                <span class="min-w-0 flex-1 truncate" lang="ja"
                  >{$t$('reader.loreKeys', { keys: entry.keys.join('、') })}</span
                >
                <span
                  >{entry.fromBook
                    ? $t$('reader.loreFrom', { title: entry.fromBook })
                    : `${entry.updated > position ? `${$t$('reader.loreLater')} · ` : ''}${$t$(
                        'reader.loreSince',
                        { count: entry.firstSeen.toLocaleString() }
                      )}`}</span
                >
                <button class="app-button app-button-quiet" on:click={() => removeEntry(entry.id)}>
                  {$t$('reader.delete')}
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .lore-top {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
    padding-bottom: 1rem;
  }

  .lore-category {
    max-width: 45%;
  }

  .lore-list {
    border-top: 2px solid var(--reader-panel-fg);
  }

  .lore-list > li {
    border-bottom: 1px solid var(--rule);
  }

  .lore-entry {
    display: block;
    width: 100%;
    padding: 0.6rem 0;
    text-align: left;
    line-height: 1.6;
  }

  .lore-preview {
    display: -webkit-box;
    overflow: hidden;
    margin-top: 0.15rem;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--muted);
    font-size: var(--type-small);
  }
</style>
