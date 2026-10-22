<script lang="ts">
  import type { LibraryDisplayMode } from '$lib/data/store';

  export let mode: LibraryDisplayMode;

  const progressWidths = [42, 0, 68, 24, 88, 52, 12, 76, 35, 60, 18, 94];
</script>

<div aria-busy="true" aria-label="Loading books">
  {#if mode === 'list'}
    <div class="flex flex-col gap-[0.45rem]">
      <div class="skeleton-list-header">
        <span>Title</span>
        <span>Progress</span>
        <span>Characters</span>
        <span>Last read</span>
        <span>Bookmarked</span>
      </div>
      {#each progressWidths.slice(0, 8) as width, index}
        <div class="skeleton-list-row">
          <span class="app-skeleton h-[0.9rem]" style:width="{76 + (index % 3) * 8}%" />
          <span class="flex items-center gap-2">
            <span class="relative h-[0.55rem] flex-1 overflow-hidden app-skeleton">
              <span
                class="absolute inset-y-0 left-0 app-skeleton opacity-60"
                style:width="{width}%"
              />
            </span>
            <span class="app-skeleton h-3 w-8" />
          </span>
          {#each { length: 3 } as _}
            <span class="app-skeleton h-3" style:width="{index % 2 ? 52 : 68}%" />
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    <div class="skeleton-grid" class:skeleton-grid-compact={mode === 'covers-compact'}>
      {#each progressWidths as width}
        <div class="skeleton-card">
          <div class="skeleton-cover app-skeleton" />
          <span class="skeleton-track" />
          {#if mode === 'covers-comfortable'}
            <div class="flex flex-col gap-2 pt-3">
              <span class="app-skeleton h-3" style:width="{60 + (width % 35)}%" />
              <span class="app-skeleton h-2.5 w-1/2" />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Same columns as book-card-list.svelte */
  .skeleton-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 8.75rem);
    justify-content: space-between;
    gap: 2.5rem 1.5rem;
  }

  .skeleton-grid-compact {
    grid-template-columns: repeat(auto-fill, 6.25rem);
    gap: 1.5rem 1rem;
  }

  @media (max-width: 639px) {
    .skeleton-grid {
      grid-template-columns: repeat(auto-fill, 6.5rem);
      gap: 1.75rem 0.75rem;
    }

    .skeleton-grid-compact {
      grid-template-columns: repeat(auto-fill, 4.75rem);
    }
  }

  .skeleton-card {
    min-width: 0;
  }

  .skeleton-cover {
    aspect-ratio: 375 / 529;
  }

  .skeleton-track {
    display: block;
    height: 3px;
    margin-top: 0.4rem;
    background: var(--app-progress-track);
  }

  .skeleton-list-header,
  .skeleton-list-row {
    display: grid;
    grid-template-columns:
      minmax(10rem, 3.6fr) minmax(6rem, 0.82fr) minmax(4rem, 0.55fr)
      minmax(4.5rem, 0.62fr) minmax(4.5rem, 0.62fr);
    align-items: center;
    gap: 0.5rem;
  }

  .skeleton-list-header {
    padding: 0 1.1rem 0.25rem;
    color: color-mix(in srgb, var(--font-color) 58%, var(--surface-color));
    font-size: 0.72rem;
    font-weight: 700;
  }

  .skeleton-list-header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skeleton-list-row {
    min-height: 3.35rem;
    padding: 0.35rem 1.1rem;
    border-bottom: 1px solid var(--border-color);
  }
</style>
