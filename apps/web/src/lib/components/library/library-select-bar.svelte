<script lang="ts">
  import {
    faBookOpen,
    faCalendarXmark,
    faChartLine,
    faCloudArrowUp,
    faGaugeHigh,
    faLayerGroup,
    faPlus,
    faRotateLeft,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The library's select mode bar (routes/manage), fixed to the bottom: the count, Select all,
   * Cancel and the actions on the selection. The page owns the selection and runs the actions;
   * the .library-toolbar-button styles are the page's (shared with its progress bar).
   */

  interface Props {
    /** Books selected */
    count: number;
    isHome: boolean;
    onselectall: () => void;
    oncancel: () => void;
    onaddtohome: () => void;
    onread: () => void;
    onmakeseries: () => void;
    onclearprogress: () => void;
    onexport: () => void;
    onstatistics: () => void;
    ondeletestatistics: () => void;
    ondifficulty: () => void;
    ondelete: () => void;
  }

  let {
    count,
    isHome,
    onselectall,
    oncancel,
    onaddtohome,
    onread,
    onmakeseries,
    onclearprogress,
    onexport,
    onstatistics,
    ondeletestatistics,
    ondifficulty,
    ondelete
  }: Props = $props();
</script>

<div class="library-select-bar" role="toolbar" aria-label={$t$('library.selectBooks')}>
  <span class="library-select-count">
    {$t$('library.selected', { count })}
  </span>
  <!-- Home's shelves aren't the list Select all works on -->
  {#if !isHome}
    <button
      type="button"
      class="app-button app-button-quiet"
      title={$t$('library.selectAllHint')}
      onclick={onselectall}
    >
      {$t$('library.selectAll')}
    </button>
  {/if}
  <button
    type="button"
    class="app-button app-button-quiet"
    title={$t$('library.stopSelecting')}
    onclick={oncancel}
  >
    {$t$('library.cancel')}
  </button>
  <span class="library-select-actions">
    <button
      type="button"
      class="library-toolbar-button library-toolbar-button-primary"
      title={$t$('home.addSelected')}
      disabled={!count}
      onclick={onaddtohome}
    >
      <Fa icon={faPlus} />
      <span class="library-toolbar-label">{$t$('home.add')}</span>
    </button>
    <button
      type="button"
      class="library-toolbar-button"
      title={$t$('library.readSelected')}
      disabled={count !== 1}
      onclick={onread}
    >
      <Fa icon={faBookOpen} />
      <span class="library-toolbar-label">{$t$('book.read')}</span>
    </button>
    {#if $storageSource$ === StorageKey.BROWSER || ($storageSource$ === StorageKey.CALIBRE && hasPermission($account$, 'series'))}
      <button
        type="button"
        class="library-toolbar-button"
        title={$t$('library.makeSeriesHint')}
        disabled={count !== 1}
        onclick={onmakeseries}
      >
        <Fa icon={faLayerGroup} />
        <span class="library-toolbar-label">{$t$('library.makeSeries')}</span>
      </button>
    {/if}
    {#if $storageSource$ !== StorageKey.FS}
      <button
        type="button"
        class="library-toolbar-button"
        title={$t$('library.clearProgressHint')}
        disabled={!count}
        onclick={onclearprogress}
      >
        <Fa icon={faRotateLeft} />
        <span class="library-toolbar-label">{$t$('library.clearProgress')}</span>
      </button>
    {/if}
    <button
      type="button"
      class="library-toolbar-button"
      title={$t$('library.exportHint')}
      disabled={!count}
      onclick={onexport}
    >
      <Fa icon={faCloudArrowUp} />
      <span class="library-toolbar-label">{$t$('library.export')}</span>
    </button>
    {#if $storageSource$ === StorageKey.BROWSER}
      <button
        type="button"
        class="library-toolbar-button"
        title={$t$('library.statisticsHint')}
        aria-label={$t$('library.statisticsHint')}
        disabled={!count}
        onclick={onstatistics}
      >
        <Fa icon={faChartLine} />
      </button>
      <button
        type="button"
        class="library-toolbar-button"
        title={$t$('library.deleteStatisticsHint')}
        aria-label={$t$('library.deleteStatisticsHint')}
        disabled={!count}
        onclick={ondeletestatistics}
      >
        <Fa icon={faCalendarXmark} />
      </button>
    {/if}
    {#if $storageSource$ === StorageKey.CALIBRE}
      <button
        type="button"
        class="library-toolbar-button"
        title={$t$('library.difficultyHint')}
        disabled={!count}
        onclick={ondifficulty}
      >
        <Fa icon={faGaugeHigh} />
        <span class="library-toolbar-label">{$t$('library.sortDifficulty')}</span>
      </button>
    {/if}
    <button
      type="button"
      class="library-toolbar-button library-toolbar-button-danger"
      title={$t$('library.deleteSelected')}
      disabled={!count}
      onclick={ondelete}
    >
      <Fa icon={faTrash} />
      <span class="library-toolbar-label">{$t$('library.delete')}</span>
    </button>
  </span>
</div>

<style>
  /* Select mode: a ruled action bar fixed to the bottom (above the phone tab bar) */
  .library-select-bar {
    position: fixed;
    inset: auto 0 0;
    z-index: 30;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    padding: 0.75rem clamp(1rem, 3.125vw, 2.5rem) calc(0.75rem + env(safe-area-inset-bottom));
    border-top: 2px solid var(--font-color);
    background: var(--background-color);
  }

  @media (max-width: 639px) {
    .library-select-bar {
      bottom: calc(3.5rem + env(safe-area-inset-bottom));
      gap: 0.5rem 1rem;
      padding-bottom: 0.75rem;
    }
  }

  .library-select-count {
    font-size: var(--type-body);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .library-select-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-left: auto;
  }
</style>
