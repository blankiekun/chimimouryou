<script lang="ts">
  import {
    faDownload,
    faForward,
    faSpinner,
    faStop,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { lorebookAutoInterval$ } from '$lib/data/ai-settings';
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
    isExtrasSynced,
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
    if (isExtrasSynced(title)) {
      enableExtrasSync(sendTarget);
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

<div class="flex min-h-0 flex-1 flex-col">
  <div class="px-4 pt-3 text-xs">
    {#if lorebook}
      <p class="mb-2 opacity-80">
        {$t$('reader.loreReadUpTo', { count: lorebook.processedUpTo.toLocaleString() })}
        {$lorebookAutoInterval$
          ? $t$('reader.loreAuto', { count: $lorebookAutoInterval$.toLocaleString() })
          : $t$('reader.loreAutoOff')}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="reader-panel-chip rounded-full px-3 py-1.5 font-semibold disabled:opacity-50"
          disabled={running || pending < minUpdateCharacters}
          title={$t$('reader.loreUpdateTitle', {
            count: pending.toLocaleString(),
            model: recapModel()
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
            class="flex items-center gap-1 p-1.5"
            title={$t$('reader.loreStopTitle')}
            on:click={() => stopLorebookUpdate(title)}
          >
            <Fa icon={faStop} /> {$t$('reader.stop')}
          </button>
        {/if}
        <span class="flex-1" />
        <button
          class="p-1.5"
          title={$t$('reader.loreSend')}
          disabled={!lorebook.entries.length}
          on:click={showSendTargets}
        >
          <Fa icon={faForward} />
        </button>
        <button
          class="p-1.5"
          title={$t$('reader.loreExport')}
          disabled={!lorebook.entries.length}
          on:click={exportJson}
        >
          <Fa icon={faDownload} />
        </button>
        <button class="p-1.5" title={$t$('reader.loreClear')} disabled={running} on:click={clearAll}>
          <Fa icon={faTrash} />
        </button>
      </div>
      {#if sendTargets?.length}
        <div class="mt-2 flex items-center gap-2">
          <select class="filter min-w-0 flex-1 rounded-lg px-2 py-1.5" bind:value={sendTarget}>
            {#each sendTargets as book (book.title)}
              <option value={book.title}>
                {book.seriesIndex ?? '?'} · {book.title}{$homeBookTitles$.includes(book.title)
                  ? ` (${$t$('nav.home')})`
                  : ''}
              </option>
            {/each}
          </select>
          <button class="reader-panel-chip rounded-full px-3 py-1.5 font-semibold" on:click={send}>
            {$t$('reader.loreCopy')}
          </button>
        </div>
      {/if}
      {#if sendMessage}<p class="mt-2 opacity-70">{sendMessage}</p>{/if}
      {#if progress}<p class="mt-2 opacity-70">{progress}</p>{/if}
    {/if}
    {#if error}<p class="mt-2 text-panel-danger">{error}</p>{/if}
    {#if $extrasSyncError$.lorebook}<p class="mt-2 text-panel-danger">
        {$extrasSyncError$.lorebook}
      </p>{/if}

    <div class="mt-3 flex flex-wrap gap-1">
      <button class="chip" class:chip-active={!category} on:click={() => (category = '')}
        >{$t$('reader.all')}</button
      >
      {#each loreCategories as option}
        {#if counts[option]}
          <button
            class="chip"
            class:chip-active={category === option}
            on:click={() => (category = option)}
          >
            {categoryLabels(option)}
            {counts[option]}
          </button>
        {/if}
      {/each}
    </div>
    <input
      class="filter mt-2 w-full rounded-lg px-2 py-1.5"
      placeholder={$t$('reader.loreFilter')}
      bind:value={filter}
    />
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-2">
    {#if lorebook && !lorebook.entries.length}
      <p class="px-2 py-6 text-center text-sm opacity-70">
        {$t$('reader.loreEmpty')}
      </p>
    {/if}
    {#each visible as entry (entry.id)}
      <div class="entry rounded-lg px-2 py-2">
        <button
          class="w-full text-left"
          on:click={() => (openEntry = openEntry === entry.id ? '' : entry.id)}
        >
          <span class="font-semibold" lang="ja">{entry.name}</span>
          {#if entry.reading && entry.reading !== entry.name}
            <span class="text-xs opacity-60" lang="ja">{entry.reading}</span>
          {/if}
          <span class="ml-1 text-xs opacity-50">{categoryLabels(entry.category)}</span>
          {#if openEntry !== entry.id}
            <span class="entry-preview mt-0.5 block text-xs opacity-75">{entry.content}</span>
          {/if}
        </button>
        {#if openEntry === entry.id}
          <textarea
            class="filter mt-1 w-full rounded-lg p-2 text-xs leading-relaxed"
            rows="5"
            value={entry.content}
            on:change={(e) => editContent(entry.id, e.currentTarget.value)}
          />
          <div class="flex items-center gap-2 text-xs opacity-60">
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
            <button class="p-1" title={$t$('reader.loreDeleteEntry')} on:click={() => removeEntry(entry.id)}>
              <Fa icon={faTrash} />
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .entry:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);
  }

  .entry-preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .chip {
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-weight: 600;
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
  }

  .chip-active {
    background: color-mix(in srgb, var(--reader-panel-fg) 22%, transparent);
  }

  .filter {
    color: inherit;
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
  }
</style>
