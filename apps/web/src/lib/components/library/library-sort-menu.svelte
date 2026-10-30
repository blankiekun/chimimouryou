<script lang="ts">
  import { nextSortOption } from '$lib/components/book-card/library-sort';
  import Popover from '$lib/components/popover/popover.svelte';
  import { ankiKnownWords$ } from '$lib/data/anki';
  import { SortDirection, type SortOption } from '$lib/data/sort-types';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import {
    booklistSortOptions$,
    libraryDisplayMode$,
    type LibraryDisplayMode
  } from '$lib/data/store';
  import { t$, type MessageKey } from '$lib/i18n';
  import {
    faArrowDown,
    faBorderAll,
    faChevronDown,
    faGrip,
    faList
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  /**
   * The library's sort options: inline (the sort list alone), or (default) the Store bar's
   * "Sort: <current>" button opening the view choices and them.
   */
  export let inline = false;

  const displayModes: { mode: LibraryDisplayMode; label: MessageKey; icon: typeof faGrip }[] = [
    { mode: 'covers-comfortable', label: 'library.viewCovers', icon: faBorderAll },
    { mode: 'covers-compact', label: 'library.viewCompact', icon: faGrip },
    { mode: 'list', label: 'library.viewList', icon: faList }
  ];

  let sortMenuItems: { property: SortOption['property']; label: string; title?: string }[];
  $: sortMenuItems = [
    ...($storageSource$ === StorageKey.BROWSER
      ? [{ property: 'id' as SortOption['property'], label: $t$('library.sortId') }]
      : []),
    { property: 'title' as SortOption['property'], label: $t$('library.sortTitle') },
    { property: 'series' as SortOption['property'], label: $t$('library.sortSeries') },
    { property: 'difficulty' as SortOption['property'], label: $t$('library.sortDifficulty') },
    ...($ankiKnownWords$ && $storageSource$ === StorageKey.CALIBRE
      ? [
          {
            property: 'coverage' as SortOption['property'],
            label: $t$('library.sortCoverage'),
            title: $t$('library.sortCoverageHint')
          }
        ]
      : []),
    { property: 'progress' as SortOption['property'], label: $t$('library.sortProgress') },
    { property: 'characters' as SortOption['property'], label: $t$('library.sortCharacters') },
    { property: 'lastBookOpen' as SortOption['property'], label: $t$('library.sortLastRead') },
    {
      property: 'lastBookmarkModified' as SortOption['property'],
      label: $t$('library.sortBookmarked')
    },
    { property: 'lastBookModified' as SortOption['property'], label: $t$('library.sortUpdated') }
  ];

  $: currentSort = $booklistSortOptions$[$storageSource$];
  $: currentLabel =
    sortMenuItems.find((item) => item.property === currentSort.property)?.label ?? '';

  function changeSort(property: SortOption['property']) {
    booklistSortOptions$.next({
      ...$booklistSortOptions$,
      [$storageSource$]: nextSortOption(currentSort, property)
    });
  }
</script>

{#if inline}
  <div class="app-popover-heading">{$t$('library.sortBy')}</div>
  {#each sortMenuItems as sortMenuItem (sortMenuItem.property)}
    {@const isCurrent = currentSort.property === sortMenuItem.property}
    <button
      type="button"
      class="app-popover-item"
      class:app-popover-item-active={isCurrent}
      title={sortMenuItem.title}
      on:click={() => changeSort(sortMenuItem.property)}
    >
      <span class="flex-1">{sortMenuItem.label}</span>
      {#if isCurrent}
        <span
          class="inline-flex text-xs transition-transform"
          class:rotate-180={currentSort.direction === SortDirection.ASC}
          title={$t$(
            currentSort.direction === SortDirection.ASC ? 'library.ascending' : 'library.descending'
          )}
        >
          <Fa icon={faArrowDown} />
        </span>
      {/if}
    </button>
  {/each}
{:else}
  <Popover placement="bottom-end" fallbackPlacements={['bottom', 'bottom-start']} yOffset={6}>
    <button slot="icon" type="button" class="app-button library-sort-button">
      {$t$('library.sortCurrent', { label: currentLabel })}
      <Fa icon={faChevronDown} size="xs" />
    </button>
    <div slot="content" class="flex w-60 flex-col">
      <div class="app-popover-heading">{$t$('library.view')}</div>
      <div class="grid grid-cols-3 gap-1 px-1 pb-1">
        {#each displayModes as displayMode (displayMode.mode)}
          <button
            type="button"
            class="app-popover-item flex-col justify-center gap-1 text-xs"
            class:app-popover-item-active={$libraryDisplayMode$ === displayMode.mode}
            aria-pressed={$libraryDisplayMode$ === displayMode.mode}
            on:click={() => ($libraryDisplayMode$ = displayMode.mode)}
          >
            <Fa icon={displayMode.icon} />
            <span class="text-center leading-tight">{$t$(displayMode.label)}</span>
          </button>
        {/each}
      </div>
      <svelte:self inline />
    </div>
  </Popover>
{/if}

<style>
  .library-sort-button {
    gap: 0.5rem;
  }
</style>
