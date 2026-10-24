<script lang="ts">
  import { browser } from '$app/environment';
  import { faChevronLeft, faEllipsis, faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import ReaderSheet from '$lib/components/book-reader/reader-sheet.svelte';
  import { furiganaProgress$ } from '$lib/data/generated-furigana';
  import { furiganaChoice, furiganaSettings, type FuriganaChoice } from '$lib/data/reader-panel';
  import {
    fontSize$,
    furiganaStyle$,
    hideFurigana$,
    unknownWordUnderline$,
    viewMode$,
    writingMode$
  } from '$lib/data/store';
  import {
    customAppThemes$,
    selectedThemeId$,
    selectTheme,
    themeDefinitions$
  } from '$lib/data/theme/theme-store';
  import { resolveTheme } from '$lib/data/theme/themes';
  import { ViewMode } from '$lib/data/view-mode';
  import { isOnOldUrl } from '$lib/functions/utils';
  import { createEventDispatcher } from 'svelte';
  import { t$, type MessageKey } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The reader's slim bar (Study Book): back, title with chapter and progress, Aa (quick
   * settings), More, and the panel toggle. Not part of upstream's layout.
   */
  export let title: string;
  /** The book can have a readings file, so unknown words can be underlined */
  export let canUnderlineUnknown = false;
  export let chapter: string;
  export let progress: string;
  export let panelOpen: boolean;
  export let hasText: boolean;
  export let hasCustomReadingPoint: boolean;
  export let canSetReadingPoint: boolean;
  export let showFullscreenButton: boolean;
  export let hasBookmarkData: boolean;
  /** Continuous mode: the auto-scroll speed, else undefined */
  export let autoScrollMultiplier: number | undefined;
  /** The reading tracker is available; whether it is paused */
  export let tracker: { paused: boolean } | undefined;

  const dispatch = createEventDispatcher<{
    back: void;
    panelClick: void;
    bookmarkClick: void;
    scrollToBookmarkClick: void;
    showCustomReadingPoint: void;
    setCustomReadingPoint: void;
    resetCustomReadingPoint: void;
    autoScrollClick: void;
    fullscreenClick: void;
    trackerClick: void;
    completeBook: void;
    jumpClick: void;
    readerImageGalleryClick: void;
    statisticsClick: void;
    wordsClick: void;
    settingsClick: void;
    domainHintClick: void;
    /** Direction or view changed: the reader saves the place, then applies it */
    layoutChange: () => void;
  }>();

  type Action = Parameters<typeof dispatch>[0];

  const directions = [
    ['vertical-rl', 'reader.vertical'],
    ['horizontal-tb', 'reader.horizontal']
  ] as const;
  const views = [
    [ViewMode.Paginated, 'reader.pages'],
    [ViewMode.Continuous, 'reader.scroll']
  ] as const;
  const furiganaChoices = [
    ['show', 'reader.furiganaShow'],
    ['known', 'reader.furiganaKnown'],
    ['hide', 'reader.furiganaHide']
  ] as const;

  let sheet: '' | 'aa' | 'more' = '';

  $: themes = ($themeDefinitions$ ?? []).map((definition) =>
    resolveTheme(definition.id, $customAppThemes$)
  );
  $: furigana = furiganaChoice($hideFurigana$, $furiganaStyle$);
  $: vertical = $writingMode$ === 'vertical-rl';
  $: paginated = $viewMode$ === ViewMode.Paginated;

  // Grouped as in the More sheet; empty groups drop out.
  $: moreGroups = [
    [
      ['reader.bookmarkPage', 'bookmarkClick'],
      hasBookmarkData && ['reader.returnToBookmark', 'scrollToBookmarkClick'],
      hasCustomReadingPoint && ['reader.showReadingPoint', 'showCustomReadingPoint'],
      canSetReadingPoint && ['reader.setReadingPoint', 'setCustomReadingPoint'],
      hasCustomReadingPoint && ['reader.resetReadingPoint', 'resetCustomReadingPoint']
    ],
    [
      autoScrollMultiplier !== undefined && ['reader.autoScroll', 'autoScrollClick'],
      showFullscreenButton && ['reader.fullscreen', 'fullscreenClick'],
      hasText && ['reader.jumpToPosition', 'jumpClick'],
      $readerImageGalleryPictures$.length && ['reader.images', 'readerImageGalleryClick']
    ],
    [
      tracker && [tracker.paused ? 'reader.startTracker' : 'reader.pauseTracker', 'trackerClick'],
      ['reader.completeBook', 'completeBook'],
      browser && isOnOldUrl(window)
        ? ['reader.domainHint', 'domainHintClick']
        : ['nav.statistics', 'statisticsClick'],
      ['nav.words', 'wordsClick']
    ]
  ]
    .map((group) => group.filter(Boolean) as [MessageKey, Action][])
    .filter((group) => group.length);

  function run(action: Action) {
    sheet = '';
    dispatch(action as 'back');
  }

  function setFurigana(choice: FuriganaChoice) {
    const { hideFurigana, style } = furiganaSettings(choice);

    if (style) {
      furiganaStyle$.next(style);
    }
    hideFurigana$.next(hideFurigana);
  }

  function changeLayout(apply: () => void) {
    sheet = '';
    dispatch('layoutChange', apply);
  }
</script>

<header class="reader-bar">
  <button class="bar-icon" title={$t$('nav.back')} on:click={() => dispatch('back')}>
    <Fa icon={faChevronLeft} />
  </button>
  <div class="bar-title">
    <span class="bar-book" lang="ja">{title}</span>
    <span class="bar-place"
      ><span lang="ja">{chapter}</span>{chapter && progress ? ' · ' : ''}{progress}</span
    >
  </div>
  <button
    class="bar-icon bar-aa"
    class:bar-icon-active={sheet === 'aa'}
    title={$t$('reader.quickSettings')}
    aria-expanded={sheet === 'aa'}
    on:click={() => (sheet = sheet === 'aa' ? '' : 'aa')}
  >
    Aa
  </button>
  <button
    class="bar-icon"
    class:bar-icon-active={sheet === 'more'}
    title={$t$('reader.more')}
    aria-expanded={sheet === 'more'}
    on:click={() => (sheet = sheet === 'more' ? '' : 'more')}
  >
    <Fa icon={faEllipsis} />
  </button>
  <button
    class="bar-icon"
    class:bar-icon-active={panelOpen}
    title={$t$('reader.panelToggle')}
    aria-pressed={panelOpen}
    on:click={() => dispatch('panelClick')}
  >
    <!-- A page with the panel on its right; on phones the panel is a sheet at the bottom. -->
    <svg class="hidden md:block" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect
        x="2.75"
        y="3.75"
        width="14.5"
        height="12.5"
        rx="1"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <rect
        x="11.5"
        y="3.75"
        width="5.75"
        height="12.5"
        fill="currentColor"
        opacity={panelOpen ? 1 : 0}
      />
      <path d="M11.5 4v12" stroke="currentColor" stroke-width="1.5" />
    </svg>
    <svg class="md:hidden" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect
        x="2.75"
        y="3.75"
        width="14.5"
        height="12.5"
        rx="1"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path d="M3 12h14" stroke="currentColor" stroke-width="1.5" />
    </svg>
  </button>
</header>

{#if sheet === 'aa'}
  <ReaderSheet title={$t$('reader.quickSettings')} on:close={() => (sheet = '')}>
    <div class="qs-row">
      <span>{$t$('reader.size')}</span>
      <div class="qs-stepper">
        <button
          title={$t$('reader.smaller')}
          on:click={() => fontSize$.next(Math.max(8, $fontSize$ - 1))}
        >
          <Fa icon={faMinus} />
        </button>
        <output aria-label={$t$('reader.fontSize')}>{$fontSize$}</output>
        <button title={$t$('reader.larger')} on:click={() => fontSize$.next($fontSize$ + 1)}>
          <Fa icon={faPlus} />
        </button>
      </div>
    </div>
    <div class="qs-row">
      <span>{$t$('reader.direction')}</span>
      <div class="app-segmented" role="radiogroup" aria-label={$t$('reader.direction')}>
        {#each directions as [mode, label] (mode)}
          <button
            role="radio"
            aria-checked={$writingMode$ === mode}
            class="app-segment"
            class:app-segment-selected={$writingMode$ === mode}
            on:click={() => $writingMode$ !== mode && changeLayout(() => writingMode$.next(mode))}
          >
            {$t$(label)}
          </button>
        {/each}
      </div>
    </div>
    <div class="qs-row">
      <span>{$t$('reader.view')}</span>
      <div class="app-segmented" role="radiogroup" aria-label={$t$('reader.view')}>
        {#each views as [mode, label] (mode)}
          <button
            role="radio"
            aria-checked={$viewMode$ === mode}
            class="app-segment"
            class:app-segment-selected={$viewMode$ === mode}
            on:click={() => $viewMode$ !== mode && changeLayout(() => viewMode$.next(mode))}
          >
            {$t$(label)}
          </button>
        {/each}
      </div>
    </div>
    <div class="qs-row">
      <span>{$t$('reader.furigana')}</span>
      <div class="app-segmented" role="radiogroup" aria-label={$t$('reader.furigana')}>
        {#each furiganaChoices as [choice, label] (choice)}
          <button
            role="radio"
            aria-checked={furigana === choice}
            class="app-segment"
            class:app-segment-selected={furigana === choice}
            on:click={() => setFurigana(choice)}
          >
            {$t$(label)}
          </button>
        {/each}
      </div>
    </div>
    {#if $furiganaProgress$}
      <p class="qs-note" role="status">
        {$furiganaProgress$.progress === 'queued'
          ? $t$('reader.furiganaQueued')
          : $t$('reader.furiganaPreparing', {
              percent: Math.round($furiganaProgress$.progress * 100)
            })}
      </p>
    {/if}
    {#if canUnderlineUnknown}
      <div class="qs-row">
        <span>{$t$('reader.unknownWords')}</span>
        <button
          type="button"
          role="switch"
          class="app-switch"
          aria-checked={$unknownWordUnderline$}
          aria-label={$t$('reader.unknownWords')}
          on:click={() => unknownWordUnderline$.next(!$unknownWordUnderline$)}
        >
          <span class="app-switch-thumb" />
          <span class="app-switch-text">{$t$('reader.underline')}</span>
        </button>
      </div>
    {/if}
    <div class="qs-row qs-themes">
      <span>{$t$('reader.theme')}</span>
      <div class="qs-swatches">
        {#each themes as option (option.id)}
          <button
            class="qs-swatch"
            class:qs-swatch-active={option.id === $selectedThemeId$}
            style:color={option.colors.readerText}
            style:background-color={option.colors.readerBackground}
            title={option.name}
            aria-pressed={option.id === $selectedThemeId$}
            on:click={() => selectTheme(option.id)}
          >
            あ
          </button>
        {/each}
      </div>
    </div>
    <button class="app-button-quiet mt-4" on:click={() => run('settingsClick')}>
      {$t$('reader.allSettings')} →
    </button>
  </ReaderSheet>
{/if}

{#if sheet === 'more'}
  <ReaderSheet title={$t$('reader.moreTitle')} on:close={() => (sheet = '')}>
    {#each moreGroups as group, i (i)}
      <ul class="more-group">
        {#each group as [label, action] (label)}
          <li>
            <button class="more-item" on:click={() => run(action)}>
              {$t$(label, { speed: autoScrollMultiplier ?? 1 })}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </ReaderSheet>
{/if}

<style>
  .reader-bar {
    display: flex;
    height: 3.5rem;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    /* A flat layer on the opaque page colour: some themes' panel colour is translucent (it was blurred). */
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
  }

  .bar-icon {
    display: inline-flex;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    font-size: 1.05rem;
  }

  .bar-icon:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);
  }

  .bar-icon-active,
  .bar-icon-active:hover {
    background: var(--app-spot-tint);
    color: var(--accent-strong-color);
  }

  .bar-aa {
    font-size: 1.15rem;
    font-weight: 700;
  }

  .bar-title {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    padding: 0 0.25rem;
    line-height: 1.3;
  }

  .bar-book {
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-place {
    overflow: hidden;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qs-row {
    display: flex;
    min-height: 3.75rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .qs-note {
    padding: 0.5rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }

  .qs-stepper {
    display: flex;
    border: 1px solid var(--reader-panel-fg);
    border-radius: 2px;
  }

  .qs-stepper button {
    display: inline-flex;
    width: 2.75rem;
    height: 2.5rem;
    align-items: center;
    justify-content: center;
  }

  .qs-stepper button:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);
  }

  .qs-stepper output {
    display: inline-flex;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    background: var(--reader-panel-fg);
    color: var(--reader-panel-bg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .qs-themes {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    padding: 0.75rem 0;
  }

  .qs-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .qs-swatch {
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    border-radius: 2px;
  }

  .qs-swatch-active {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .more-group {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .more-group + .more-group {
    margin-top: 0.75rem;
  }

  .more-item {
    display: flex;
    width: 100%;
    min-height: 3.25rem;
    align-items: center;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    text-align: left;
  }

  .more-item:hover {
    color: var(--accent-strong-color);
  }
</style>
