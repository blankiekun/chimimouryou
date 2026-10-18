<script lang="ts">
  import { browser } from '$app/environment';
  import { faBookmark as farBookmark } from '@fortawesome/free-regular-svg-icons';
  import {
    faBookmark as fasBookmark,
    faBookAtlas,
    faEllipsisVertical,
    faExpand,
    faFlag,
    faHeadphones,
    faList,
    faLocationDot,
    faMagnifyingGlass,
    faMinus,
    faPalette,
    faPlus,
    faRotateLeft,
    type IconDefinition
  } from '@fortawesome/free-solid-svg-icons';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import Popover from '$lib/components/popover/popover.svelte';
  import { customReadingPointEnabled$, fontSize$, viewMode$ } from '$lib/data/store';
  import {
    customAppThemes$,
    selectedThemeId$,
    selectTheme,
    themeDefinitions$
  } from '$lib/data/theme/theme-store';
  import { resolveTheme } from '$lib/data/theme/themes';
  import { ViewMode } from '$lib/data/view-mode';
  import { isMobile$, isOnOldUrl } from '$lib/functions/utils';
  import { createEventDispatcher } from 'svelte';
  import { t$, type MessageKey } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let hasChapterData: boolean;
  export let hasText: boolean;
  export let autoScrollMultiplier: number;
  export let hasCustomReadingPoint: boolean;
  export let showFullscreenButton: boolean;
  export let isBookmarkScreen: boolean;
  export let hasBookmarkData: boolean;

  const dispatch = createEventDispatcher<{
    tocClick: void;
    bookmarkClick: void;
    scrollToBookmarkClick: void;
    jumpClick: void;
    completeBook: void;
    fullscreenClick: void;
    showCustomReadingPoint: void;
    setCustomReadingPoint: void;
    resetCustomReadingPoint: void;
    statisticsClick: void;
    readerImageGalleryClick: void;
    settingsClick: void;
    domainHintClick: void;
    bookManagerClick: void;
    ttsClick: void;
    searchClick: void;
    companionClick: void;
  }>();

  const customReadingPointMenuItems: {
    label: MessageKey;
    action: any;
  }[] = [
    ...(hasCustomReadingPoint
      ? [{ label: 'reader.showPoint' as const, action: 'showCustomReadingPoint' }]
      : []),
    { label: 'reader.setPoint', action: 'setCustomReadingPoint' },
    ...(hasCustomReadingPoint
      ? [{ label: 'reader.resetPoint' as const, action: 'resetCustomReadingPoint' }]
      : [])
  ];

  const panelClasses = 'app-popover-panel';

  let customReadingPointMenuElm: Popover;
  let moreMenuElm: Popover;

  type HeaderAction = Parameters<typeof dispatch>[0];

  let moreMenuItems: {
    label: string;
    icon: IconDefinition;
    action: HeaderAction;
    classes: string;
  }[] = [];

  $: isOldUrl = browser && isOnOldUrl(window);

  $: themes = ($themeDefinitions$ ?? []).map((definition) =>
    resolveTheme(definition.id, $customAppThemes$)
  );

  $: {
    const item = (
      entry: { label: MessageKey; icon: IconDefinition },
      action: HeaderAction,
      classes = ''
    ) => ({
      label: $t$(entry.label),
      icon: entry.icon,
      action,
      classes: `app-popover-item ${classes}`
    });
    const items = [];

    // Shown in the bar on larger screens.
    if (hasBookmarkData) {
      items.push(
        item(
          { label: 'reader.returnToBookmark', icon: faRotateLeft },
          'scrollToBookmarkClick',
          'md:hidden'
        )
      );
    }
    if (showFullscreenButton) {
      items.push(item({ label: 'reader.fullscreen', icon: faExpand }, 'fullscreenClick', 'md:hidden'));
    }
    // Phones: the bar would push its icons over the back button.
    if (hasText) {
      items.push(
        item({ label: 'reader.search', icon: faMagnifyingGlass }, 'searchClick', 'sm:hidden')
      );
    }
    items.push(item({ label: 'reader.listen', icon: faHeadphones }, 'ttsClick', 'sm:hidden'));

    items.push(item({ label: 'reader.completeBook', icon: faFlag }, 'completeBook'));

    if (hasText) {
      items.push(item({ label: 'reader.jump', icon: mergeEntries.JUMP_TO_POSITION.icon }, 'jumpClick'));
    }

    if ($readerImageGalleryPictures$.length) {
      items.push(
        item(
          { label: 'reader.images', icon: mergeEntries.READER_IMAGE_GALLERY.icon },
          'readerImageGalleryClick'
        )
      );
    }

    // Larger screens have these in the section navigation.
    items.push(
      isOldUrl
        ? item({ label: 'reader.domainHint', icon: mergeEntries.DOMAIN_HINT.icon }, 'domainHintClick')
        : item(
            { label: 'nav.statistics', icon: mergeEntries.STATISTICS.icon },
            'statisticsClick',
            'sm:hidden'
          ),
      item({ label: 'nav.settings', icon: mergeEntries.SETTINGS.icon }, 'settingsClick', 'sm:hidden'),
      item({ label: 'book.library', icon: mergeEntries.MANAGE.icon }, 'bookManagerClick', 'sm:hidden')
    );

    moreMenuItems = items;
  }

  function runMoreAction(action: HeaderAction) {
    moreMenuElm.toggleOpen();
    dispatch(action);
  }

  function dispatchCustomReadingPointAction(action: any) {
    dispatch(action);
    customReadingPointMenuElm.toggleOpen();
  }
</script>

<AppHeader
  active={undefined}
  onNavigate={(section) => {
    if (section === 'statistics') {
      dispatch('statisticsClick');
    } else if (section === 'settings') {
      dispatch('settingsClick');
    } else {
      dispatch('bookManagerClick');
    }
  }}
  onBack={() => dispatch('bookManagerClick')}
>
  {#if hasChapterData}
    <button
      type="button"
      class="app-header-icon"
      title={$t$('reader.toc')}
      on:click={() => dispatch('tocClick')}
    >
      <Fa icon={faList} />
    </button>
  {/if}
  <button
    type="button"
    class="app-header-icon"
    title={$t$('reader.bookmark')}
    on:click={() => dispatch('bookmarkClick')}
  >
    <Fa icon={isBookmarkScreen ? fasBookmark : farBookmark} />
  </button>
  {#if hasBookmarkData}
    <button
      type="button"
      class="app-header-icon hidden md:inline-flex"
      title={$t$('reader.returnToBookmark')}
      on:click={() => dispatch('scrollToBookmarkClick')}
    >
      <Fa icon={faRotateLeft} />
    </button>
  {/if}
  {#if hasText}
    <button
      type="button"
      class="app-header-icon hidden sm:inline-flex"
      title={$t$('reader.search')}
      on:click={() => dispatch('searchClick')}
    >
      <Fa icon={faMagnifyingGlass} />
    </button>
  {/if}
  <button
    type="button"
    class="app-header-icon hidden sm:inline-flex"
    title={$t$('reader.listenTitle')}
    on:click={() => dispatch('ttsClick')}
  >
    <Fa icon={faHeadphones} />
  </button>
  <button
    type="button"
    class="app-header-icon"
    title={$t$('reader.companionTitle')}
    on:click={() => dispatch('companionClick')}
  >
    <Fa icon={faBookAtlas} />
  </button>
  {#if $customReadingPointEnabled$ || $viewMode$ === ViewMode.Paginated}
    <Popover
      placement="bottom"
      fallbackPlacements={['bottom-end', 'bottom-start']}
      yOffset={10}
      {panelClasses}
      bind:this={customReadingPointMenuElm}
    >
      <div slot="icon" class="app-header-icon hidden md:inline-flex" title={$t$('reader.readingPoint')}>
        <Fa icon={faLocationDot} />
      </div>
      <div slot="content" class="flex flex-col">
        {#each customReadingPointMenuItems as actionItem (actionItem.label)}
          <button
            type="button"
            class="app-popover-item"
            on:click={() => dispatchCustomReadingPointAction(actionItem.action)}
          >
            {$t$(actionItem.label)}
          </button>
        {/each}
      </div>
    </Popover>
  {/if}
  {#if showFullscreenButton}
    <button
      type="button"
      class="app-header-icon hidden md:inline-flex"
      title={$t$('reader.toggleFullscreen')}
      on:click={() => dispatch('fullscreenClick')}
    >
      <Fa icon={faExpand} />
    </button>
  {/if}
  <Popover
    placement="bottom-end"
    fallbackPlacements={['bottom', 'bottom-start']}
    yOffset={10}
    {panelClasses}
  >
    <div slot="icon" class="app-header-icon" title={$t$('reader.quickSettings')}>
      <Fa icon={faPalette} />
    </div>
    <div slot="content" class="flex w-64 flex-col gap-3 p-2">
      <div class="app-popover-heading">{$t$('reader.theme')}</div>
      <div class="flex flex-wrap gap-2 px-2">
        {#each themes as option (option.id)}
          <button
            type="button"
            class="h-9 w-9 rounded-lg border-2 text-sm"
            style:border-color={option.id === $selectedThemeId$
              ? 'var(--accent-color)'
              : 'var(--app-control-border)'}
            style:color={option.colors.readerText}
            style:background-color={option.colors.readerBackground}
            title={option.name}
            on:click={() => selectTheme(option.id)}
          >
            あ
          </button>
        {/each}
      </div>
      <div class="app-popover-heading">{$t$('reader.fontSize')}</div>
      <div class="flex items-center justify-between px-2 pb-1">
        <button
          type="button"
          class="font-size-button"
          title={$t$('reader.smaller')}
          on:click={() => fontSize$.next(Math.max(8, $fontSize$ - 1))}
        >
          <Fa icon={faMinus} />
        </button>
        <span class="font-semibold">{$fontSize$}px</span>
        <button
          type="button"
          class="font-size-button"
          title={$t$('reader.larger')}
          on:click={() => fontSize$.next($fontSize$ + 1)}
        >
          <Fa icon={faPlus} />
        </button>
      </div>
    </div>
  </Popover>
  <Popover
    placement="bottom-end"
    fallbackPlacements={['bottom', 'bottom-start']}
    yOffset={10}
    {panelClasses}
    bind:this={moreMenuElm}
  >
    <div slot="icon" class="app-header-icon" title={$t$('reader.more')}>
      <Fa icon={faEllipsisVertical} />
    </div>
    <div slot="content" class="flex flex-col">
      {#each moreMenuItems as item (item.label)}
        <button type="button" class={item.classes} on:click={() => runMoreAction(item.action)}>
          <Fa icon={item.icon} fw />
          {item.label}
        </button>
      {/each}
    </div>
  </Popover>
  {#if $viewMode$ === ViewMode.Continuous && !$isMobile$}
    <span class="px-2 text-sm font-semibold" title={$t$('reader.autoscrollSpeed')}>
      {autoScrollMultiplier}x
    </span>
  {/if}
</AppHeader>

<style>
  .font-size-button {
    display: inline-flex;
    width: 2.25rem;
    height: 2.25rem;
    align-items: center;
    justify-content: center;
    border: 1px solid currentColor;
    border-radius: 0.75rem;
    opacity: 0.8;
  }

  .font-size-button:hover {
    opacity: 1;
  }
</style>
