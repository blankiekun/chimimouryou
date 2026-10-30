<script lang="ts">
  import { browser } from '$app/env';
  import { goto, replaceState } from '$app/navigation';
  import { faArrowLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy, onMount, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import { map, share, tap } from 'rxjs';
  import Fa from 'svelte-fa';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/book-card/import-menu.svelte';
  import { setPendingImport, type PendingImport } from '$lib/data/library-home';
  import SettingsAccount from '$lib/components/settings/settings-account.svelte';
  import InstallHint from '$lib/components/standalone/install-hint.svelte';
  import SettingsAnalysisTools from '$lib/components/standalone/settings-analysis-tools.svelte';
  import SettingsSync from '$lib/components/standalone/settings-sync.svelte';
  import SettingsLanguage from '$lib/components/settings/settings-language.svelte';
  import SettingsPlugins from '$lib/components/settings/settings-plugins.svelte';
  import { activePlugins$, plugins } from '$lib/plugins';
  import { aiFeatureState$ } from '$lib/data/ai-connections';
  import SettingsAnki from '$lib/components/settings/settings-anki.svelte';
  import SettingsDictionary from '$lib/components/settings/settings-dictionary.svelte';
  import SettingsDictionaryPopup from '$lib/components/settings/settings-dictionary-popup.svelte';
  import SettingsContent from '$lib/components/settings/settings-content.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import {
    findSettingsSection,
    isFirstSectionOfArea,
    isKnownWordsLink,
    sectionFromUrl,
    setSettingsView,
    settingsAreas,
    type SettingsView
  } from '$lib/components/settings/settings-sections';
  import SettingsThemeMode from '$lib/components/settings/settings-theme-mode.svelte';
  import SettingsThemes from '$lib/components/settings/settings-themes.svelte';
  import { pagePath, standalone } from '$lib/data/env';
  import {
    addCharactersOnCompletion$,
    adjustStatisticsAfterIdleTime$,
    autoBookmark$,
    autoBookmarkTime$,
    autoPositionOnResize$,
    autoReplication$,
    avoidPageBreak$,
    cacheStorageData$,
    confirmClose$,
    customReadingPointEnabled$,
    database,
    disableWheelNavigation$,
    enableFontVPAL$,
    enableReaderWakeLock$,
    enableTapEdgeToFlip$,
    enableTextJustification$,
    enableTextWrapPretty$,
    enableVerticalFontKerning$,
    firstDimensionMargin$,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    fontSize$,
    fontWeight$,
    furiganaStyle$,
    hideExternalReadHint$,
    hideFurigana$,
    hideSpoilerImage$,
    importHTMLFixMode$,
    lineHeight$,
    manualBookmark$,
    keepLocalStatisticsOnDeletion$,
    openTrackerOnCompletion$,
    overwriteBookCompletion$,
    pageColumns$,
    pauseTrackerOnCustomPointChange$,
    prioritizeReaderStyles$,
    replicationSaveBehavior$,
    restrictImportFixToAnchor$,
    secondDimensionMaxValue$,
    selectionToBookmarkEnabled$,
    showCharacterCounter$,
    showPercentage$,
    showFooterChapterCharacterCounter$,
    showFooterChapterPercentage$,
    showExternalPlaceholder$,
    startDayHoursForTracker$,
    statisticsEnabled$,
    statisticsMergeMode$,
    swipeThreshold$,
    textIndentation$,
    textMarginMode$,
    textMarginValue$,
    trackerAutoPause$,
    trackerBackwardSkipThreshold$,
    trackerForwardSkipThreshold$,
    trackerAutostartTime$,
    trackerIdleTime$,
    trackerPopupDetection$,
    trackerSkipThresholdAction$,
    verticalTextOrientation$,
    viewMode$,
    writingMode$,
    readingGoalsMergeMode$,
    hideSpoilerImageMode$,
    readerProfile
  } from '$lib/data/store';
  import { storage } from '$lib/data/window/navigator/storage';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { writableSubject } from '$lib/functions/svelte/store';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';

  const persistentStorage$ = writableSubject(false);
  let persistentStorageReactive = false;

  /** A section counts as current once its top is this close to the viewport top. */
  const currentSectionOffsetPx = 140;
  const view = writable<SettingsView>({ area: settingsAreas[0].id, query: '' });

  setSettingsView(view);

  let activeArea = settingsAreas[0].id;
  let activeSection = settingsAreas[0].sections[0].id;
  let query = '';
  let noResults = false;
  /** Phones show the list of sections, or one area with a back button. */
  let mobileView: 'list' | 'section' = 'list';
  let sectionsElement: HTMLElement;
  let searchInput: HTMLInputElement;
  let scrollToMatchTimer: ReturnType<typeof setTimeout> | undefined;
  let themeCount: number | undefined;

  $: view.set({ area: activeArea, query });
  // Again after a language change: the texts searched are translated.
  $: applySearch(query, $uiLanguage$);
  $: searching = !!query.trim();
  // Areas of plugins that are switched off are hidden.
  $: visibleAreas = settingsAreas.filter(
    (area) =>
      !plugins.some(
        (plugin) => plugin.settingsArea === area.id && !$activePlugins$.includes(plugin)
      )
  );
  $: activeAreaInfo = settingsAreas.find((area) => area.id === activeArea) ?? settingsAreas[0];
  // While AI has no connection its first section is headed Get started (settings-ai.svelte).
  $: sectionLabel = (section: { id: string; label: MessageKey }): MessageKey =>
    section.id === 'ai-connections' && !$aiFeatureState$.ask.connection
      ? 'ai.getStarted'
      : section.label;
  $: hiddenPluginAreas = visibleAreas.length < settingsAreas.length;
  $: areaDescription =
    activeAreaInfo.id === 'reader'
      ? $t$(
          readerProfile() === 'phone'
            ? 'settings.area.reader.phone'
            : 'settings.area.reader.desktop'
        )
      : activeAreaInfo.description && $t$(activeAreaInfo.description);

  onMount(() => {
    const url = new URL(window.location.href);

    if (isKnownWordsLink(url)) {
      // Known words moved to the Words page; old links still lead there.
      window.location.replace(`${pagePath}/words`);
      return;
    }

    const requested = sectionFromUrl(url);

    if (requested) {
      // The URL already names the section, and SvelteKit's router isn't ready
      // during the first onMount (replaceState threw, so the scroll never ran).
      showSection(requested.id, false, false);
    }

    storage.persisted().then(setPersistentStorage);

    setStorageQuota();
  });

  onDestroy(() => clearTimeout(scrollToMatchTimer));

  function backToList() {
    mobileView = 'list';
    query = '';
    window.scrollTo({ top: 0 });
  }

  async function showSection(id: string, smooth = true, updateUrl = true) {
    const section = findSettingsSection(id);

    if (!section) {
      return;
    }

    query = '';
    mobileView = 'section';
    activeArea = section.area;
    activeSection = section.id;
    if (updateUrl) {
      replaceState(`?section=${section.area}#${section.id}`, {});
    }

    await tick();

    const behavior = smooth ? 'smooth' : 'auto';
    const element = document.getElementById(section.id);

    if (element && !isFirstSectionOfArea(section.id)) {
      element.scrollIntoView({ behavior, block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  }

  /** Hides settings that don't match the search; sections match by title too. */
  async function applySearch(text: string, ..._rerunOn: unknown[]) {
    await tick();

    if (!sectionsElement) {
      return;
    }

    const needle = text.trim().toLowerCase();
    let visibleSections = 0;

    sectionsElement.querySelectorAll<HTMLElement>('[data-settings-section]').forEach((section) => {
      const sectionMatch =
        !needle || (section.dataset.settingsSearch || '').toLowerCase().includes(needle);
      let visibleItems = 0;

      section.querySelectorAll<HTMLElement>('[data-settings-item]').forEach((item) => {
        const ownMatch =
          !!needle && (item.dataset.settingsSearch || '').toLowerCase().includes(needle);
        const match = sectionMatch || ownMatch;

        item.hidden = !match;
        item.toggleAttribute('data-settings-match', ownMatch);
        visibleItems += match ? 1 : 0;
      });

      section.hidden = !sectionMatch && !visibleItems;
      visibleSections += section.hidden ? 0 : 1;
    });

    noResults = !!needle && !visibleSections;

    clearTimeout(scrollToMatchTimer);
    if (needle && !noResults) {
      // Wait for typing to pause, then bring the first match into view.
      scrollToMatchTimer = setTimeout(() => {
        const first =
          sectionsElement.querySelector<HTMLElement>('[data-settings-match]') ||
          sectionsElement.querySelector<HTMLElement>('[data-settings-section]:not([hidden])');

        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350);
    }
  }

  /** Highlights the section being read in the sidebar. */
  function onScroll() {
    if (searching) {
      return;
    }

    const ids = activeAreaInfo.sections.map((section) => section.id);
    const reached = ids.filter(
      (id) =>
        (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <=
        currentSectionOffsetPx
    );

    activeSection = reached[reached.length - 1] || ids[0];
  }

  function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();

      if (!searchInput?.offsetParent) {
        mobileView = 'list';
      }

      tick().then(() => {
        searchInput?.focus();
        searchInput?.select();
      });
    }
  }

  function onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      query = '';
      (event.currentTarget as HTMLElement).blur();
    }
  }

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let storageUsed: number | undefined;

  const setPersistentStorage$ = persistentStorage$.pipe(
    tap((value) => {
      if (!persistentStorageReactive) return;
      if (!value) {
        setPersistentStorage(true);
        return;
      }

      storage.persist().then(setPersistentStorage).finally(setStorageQuota);
    }),
    reduceToEmptyString()
  );

  function setPersistentStorage(value: boolean) {
    persistentStorageReactive = false;
    persistentStorage$.next(value);
    persistentStorageReactive = true;
  }

  function setStorageQuota() {
    storage
      .estimate()
      .then((storageData) => {
        const { usage, quota } = storageData;

        if (usage === undefined || quota === undefined) {
          return;
        }

        storageUsed = Math.round(((usage / quota) * 100 + Number.EPSILON) * 100) / 100;
      })
      .catch(() => {
        // no-op
      });
  }

  function importOnManage(value: PendingImport) {
    setPendingImport(value);
    goto(`${pagePath}/manage`);
  }
</script>

<svelte:head>
  <title>{formatPageTitle($t$('nav.settings'))}</title>
</svelte:head>

<svelte:window on:keydown={onKeydown} on:scroll={onScroll} />

<div class="app-page-shell">
  <AppHeader active="settings" currentBookId={$currentBookId$}>
    <!-- The import runs (with its progress and errors) in the library. -->
    <ImportMenu
      on:filesChange={(ev) => importOnManage({ files: Array.from(ev.detail) })}
      on:importBackup={(ev) => importOnManage({ backup: ev.detail })}
    />
  </AppHeader>

  <div class="settings-layout" data-mobile={searching ? 'search' : mobileView}>
    <aside class="settings-sidebar" aria-label={$t$('settings.categories')}>
      <h1 class="settings-index-title">{$t$('nav.settings')}</h1>
      <div class="settings-search" role="search">
        <input
          bind:this={searchInput}
          bind:value={query}
          type="search"
          placeholder={$t$('settings.search')}
          aria-label={$t$('settings.searchLabel')}
          aria-keyshortcuts="Control+F Meta+F"
          on:keydown={onSearchKeydown}
        />
        <kbd class="settings-search-shortcut" aria-hidden="true">Ctrl+F</kbd>
      </div>
      <nav class="settings-nav" aria-label={$t$('settings.sectionsLabel')}>
        {#each visibleAreas as area, areaIndex (area.id)}
          {@const current = !searching && area.id === activeArea}
          <div class="settings-nav-area">
            <button
              type="button"
              class="settings-nav-area-button"
              class:settings-nav-area-active={current}
              aria-current={current ? 'true' : undefined}
              on:click={() => showSection(area.sections[0].id)}
            >
              <span class="settings-nav-number">{String(areaIndex + 1).padStart(2, '0')}</span>
              <span class="settings-nav-area-text">
                <span class="settings-nav-area-label">{$t$(area.label)}</span>
                <span class="settings-nav-area-sections">
                  {area.sections.map((section) => $t$(sectionLabel(section))).join(' · ')}
                </span>
              </span>
              <span class="settings-nav-chevron"><Fa icon={faChevronRight} /></span>
            </button>
            {#if current}
              <div class="settings-nav-items">
                {#each area.sections as section (section.id)}
                  <button
                    type="button"
                    class="settings-nav-item"
                    class:settings-nav-item-active={section.id === activeSection}
                    aria-current={section.id === activeSection ? 'location' : undefined}
                    on:click={() => showSection(section.id)}
                  >
                    {$t$(sectionLabel(section))}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>
      {#if hiddenPluginAreas}
        <p class="settings-plugin-note">{$t$('settings.pluginNote')}</p>
      {/if}
    </aside>

    <main class="settings-main" aria-label={$t$('nav.settings')}>
      <button type="button" class="settings-back app-button app-button-quiet" on:click={backToList}>
        <Fa icon={faArrowLeft} />
        {$t$('nav.settings')}
      </button>
      {#if searching}
        <h1 class="settings-title" aria-live="polite">
          {$t$('settings.results', { query: query.trim() })}
        </h1>
      {:else}
        <header class="settings-area-head">
          <h1 class="settings-title">{$t$(activeAreaInfo.label)}</h1>
          {#if areaDescription}<p>{areaDescription}</p>{/if}
        </header>
        {#if activeAreaInfo.sections.length > 1}
          <div class="settings-chips" aria-label={$t$('settings.sectionsLabel')}>
            {#each activeAreaInfo.sections as section (section.id)}
              <button
                type="button"
                class="settings-chip"
                class:settings-chip-active={section.id === activeSection}
                aria-current={section.id === activeSection ? 'location' : undefined}
                on:click={() => showSection(section.id)}
              >
                {$t$(sectionLabel(section))}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
      {#if noResults}
        <div class="settings-no-results" role="status">
          <p>{$t$('settings.noResults', { query: query.trim() })}</p>
          <button type="button" class="app-button" on:click={() => (query = '')}>
            {$t$('settings.clearSearch')}
          </button>
        </div>
      {/if}
      <div class="settings-sections" bind:this={sectionsElement}>
        <!-- Rows name their switches once (settings-item-group.svelte): remount on a language change. -->
        {#key $uiLanguage$}
          {#if standalone}
            <SettingsSection id="general-install" keywords="install home screen app offline">
              <InstallHint settings />
            </SettingsSection>
            <SettingsAnalysisTools />
            <SettingsSync />
          {:else}
            <SettingsSection id="general-account">
              <SettingsAccount />
            </SettingsSection>
          {/if}
          <SettingsSection id="general-language" keywords="language japanese english 日本語 言語">
            <SettingsLanguage />
          </SettingsSection>
          <SettingsSection
            id="general-theme"
            keywords="editor colors colours import export json css font roundness blur custom"
            count={themeCount}
            wide
          >
            <SettingsThemeMode />
            <SettingsThemes bind:count={themeCount} />
          </SettingsSection>
          <SettingsPlugins />
          {#each $activePlugins$ as plugin (plugin.id)}
            {#if plugin.settings}
              <svelte:component this={plugin.settings} />
            {/if}
          {/each}
          <SettingsAnki />
          <SettingsDictionary />
          <SettingsDictionaryPopup />
          <SettingsContent
            storageQuota={storageUsed === undefined
              ? ''
              : $t$('prefs.used', { percent: storageUsed })}
            bind:fontFamilyGroupOne={$fontFamilyGroupOne$}
            bind:fontFamilyGroupTwo={$fontFamilyGroupTwo$}
            bind:fontWeight={$fontWeight$}
            bind:fontSize={$fontSize$}
            bind:lineHeight={$lineHeight$}
            bind:textIndentation={$textIndentation$}
            bind:textMarginValue={$textMarginValue$}
            bind:blurImage={$hideSpoilerImage$}
            bind:blurImageMode={$hideSpoilerImageMode$}
            bind:hideFurigana={$hideFurigana$}
            bind:furiganaStyle={$furiganaStyle$}
            bind:writingMode={$writingMode$}
            bind:enableFontKerning={$enableVerticalFontKerning$}
            bind:enableFontVPAL={$enableFontVPAL$}
            bind:verticalTextOrientation={$verticalTextOrientation$}
            bind:prioritizeReaderStyles={$prioritizeReaderStyles$}
            bind:enableTextJustification={$enableTextJustification$}
            bind:enableTextWrapPretty={$enableTextWrapPretty$}
            bind:textMarginMode={$textMarginMode$}
            bind:enableReaderWakeLock={$enableReaderWakeLock$}
            bind:showCharacterCounter={$showCharacterCounter$}
            bind:showPercentage={$showPercentage$}
            bind:showFooterChapterCharacterCounter={$showFooterChapterCharacterCounter$}
            bind:showFooterChapterPercentage={$showFooterChapterPercentage$}
            bind:viewMode={$viewMode$}
            bind:secondDimensionMaxValue={$secondDimensionMaxValue$}
            bind:firstDimensionMargin={$firstDimensionMargin$}
            bind:swipeThreshold={$swipeThreshold$}
            bind:disableWheelNavigation={$disableWheelNavigation$}
            bind:autoPositionOnResize={$autoPositionOnResize$}
            bind:avoidPageBreak={$avoidPageBreak$}
            bind:pauseTrackerOnCustomPointChange={$pauseTrackerOnCustomPointChange$}
            bind:customReadingPointEnabled={$customReadingPointEnabled$}
            bind:selectionToBookmarkEnabled={$selectionToBookmarkEnabled$}
            bind:enableTapEdgeToFlip={$enableTapEdgeToFlip$}
            bind:pageColumns={$pageColumns$}
            bind:persistentStorage={$persistentStorage$}
            bind:hideExternalReadHint={$hideExternalReadHint$}
            bind:confirmClose={$confirmClose$}
            bind:manualBookmark={$manualBookmark$}
            bind:autoBookmark={$autoBookmark$}
            bind:autoBookmarkTime={$autoBookmarkTime$}
            bind:importHTMLFixMode={$importHTMLFixMode$}
            bind:restrictImportFixToAnchor={$restrictImportFixToAnchor$}
            bind:cacheStorageData={$cacheStorageData$}
            bind:replicationSaveBehavior={$replicationSaveBehavior$}
            bind:autoReplication={$autoReplication$}
            bind:showExternalPlaceholder={$showExternalPlaceholder$}
            bind:keepLocalStatisticsOnDeletion={$keepLocalStatisticsOnDeletion$}
            bind:overwriteBookCompletion={$overwriteBookCompletion$}
            bind:startDayHoursForTracker={$startDayHoursForTracker$}
            bind:statisticsMergeMode={$statisticsMergeMode$}
            bind:readingGoalsMergeMode={$readingGoalsMergeMode$}
            bind:statisticsEnabled={$statisticsEnabled$}
            bind:trackerAutoPause={$trackerAutoPause$}
            bind:openTrackerOnCompletion={$openTrackerOnCompletion$}
            bind:addCharactersOnCompletion={$addCharactersOnCompletion$}
            bind:trackerAutoStartTime={$trackerAutostartTime$}
            bind:trackerIdleTime={$trackerIdleTime$}
            bind:trackerForwardSkipThreshold={$trackerForwardSkipThreshold$}
            bind:trackerBackwardSkipThreshold={$trackerBackwardSkipThreshold$}
            bind:trackerSkipThresholdAction={$trackerSkipThresholdAction$}
            bind:trackerPopupDetection={$trackerPopupDetection$}
            bind:adjustStatisticsAfterIdleTime={$adjustStatisticsAfterIdleTime$}
          />
        {/key}
      </div>
    </main>
  </div>
</div>
{$setPersistentStorage$ ?? ''}

<style>
  .settings-layout {
    display: grid;
    max-width: 75rem;
    min-width: 0;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 5.25rem 1rem 3rem;
  }

  .settings-index-title,
  .settings-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .settings-area-head p {
    margin-top: 0.35rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .settings-search {
    display: flex;
    min-height: var(--app-control-height);
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--app-control-bg);
  }

  .settings-search:focus-within {
    border-color: var(--app-focus-ring);
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .settings-search input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: var(--font-color);
    font-size: var(--type-small);
    outline: 0;
  }

  .settings-search input::placeholder {
    color: var(--app-muted-fg);
  }

  .settings-search-shortcut {
    flex: none;
    color: var(--app-muted-fg);
    font-family: inherit;
    font-size: var(--type-small);
  }

  .settings-nav {
    display: grid;
    min-width: 0;
  }

  .settings-nav-area-button {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 2.6rem;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    border-left: 3px solid transparent;
    color: var(--font-color);
    font-size: var(--type-body);
    text-align: left;
  }

  .settings-nav-area-button:hover {
    background: color-mix(in srgb, var(--font-color) 5%, transparent);
  }

  .settings-nav-number {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }

  .settings-nav-area-text {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .settings-nav-area-sections,
  .settings-nav-chevron {
    display: none;
  }

  .settings-nav-area-active,
  .settings-nav-area-active:hover {
    border-left-color: var(--accent-color);
    background: var(--app-spot-tint);
  }

  .settings-nav-area-active .settings-nav-number {
    color: var(--accent-strong-color);
  }

  .settings-nav-items {
    display: grid;
    padding: 0.35rem 0 0.5rem 2.6rem;
  }

  .settings-nav-item {
    min-height: 2rem;
    padding: 0.2rem 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-align: left;
  }

  .settings-nav-item:hover {
    color: var(--font-color);
  }

  .settings-nav-item-active,
  .settings-nav-item-active:hover {
    color: var(--accent-strong-color);
  }

  .settings-plugin-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .settings-main {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.5rem;
  }

  .settings-back {
    display: none;
    align-self: flex-start;
    margin-bottom: 0.75rem;
  }

  .settings-chips {
    display: none;
  }

  .settings-no-results {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 2px solid var(--font-color);
    color: var(--app-muted-fg);
  }

  /* Sections come from several components; CSS order keeps the sidebar's order. */
  .settings-sections {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3.5rem;
    margin-top: 2rem;
  }

  .settings-sections :global([data-settings-section][hidden]),
  .settings-sections :global([data-settings-item][hidden]) {
    display: none;
  }

  /* Phones: a ruled list of areas that drills into one area, with a back link */
  @media (max-width: 899px) {
    .settings-layout[data-mobile='list'] .settings-main,
    .settings-layout[data-mobile='section'] .settings-sidebar,
    .settings-layout[data-mobile='search'] .settings-nav,
    .settings-layout[data-mobile='search'] .settings-plugin-note,
    .settings-layout[data-mobile='search'] .settings-index-title,
    .settings-search-shortcut {
      display: none;
    }

    .settings-sidebar {
      display: grid;
      gap: 1.5rem;
    }

    .settings-layout[data-mobile='section'] .settings-back {
      display: inline-flex;
    }

    .settings-nav {
      border-top: 2px solid var(--font-color);
    }

    .settings-nav-area-button,
    .settings-nav-area-active,
    .settings-nav-area-active:hover {
      min-height: 4.5rem;
      padding: 0.75rem 0;
      border-left: 0;
      border-bottom: 1px solid var(--border-color);
      background: transparent;
    }

    .settings-nav-number {
      width: 1.25rem;
      color: var(--accent-strong-color);
      font-size: var(--type-small);
    }

    .settings-nav-area-label {
      font-size: 1.0625rem;
    }

    .settings-nav-area-sections {
      display: block;
      margin-top: 0.2rem;
      color: var(--app-muted-fg);
      font-size: var(--type-small);
      line-height: 1.5;
    }

    .settings-nav-chevron {
      display: inline-flex;
      flex: none;
      color: var(--app-muted-fg);
      font-size: 0.7rem;
    }

    .settings-nav-items {
      display: none;
    }

    .settings-chips {
      display: flex;
      gap: 0.5rem;
      margin: 1rem -1rem 0;
      padding: 0 1rem 0.25rem;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .settings-chip {
      flex: none;
      min-height: var(--app-control-height);
      padding: 0 0.7rem;
      border: 1px solid var(--border-color);
      border-radius: 2px;
      color: var(--font-color);
      font-size: var(--type-small);
      white-space: nowrap;
    }

    .settings-chip-active {
      border-color: var(--font-color);
      background: var(--font-color);
      color: var(--background-color);
    }

    .settings-sections {
      gap: 2.5rem;
      margin-top: 1rem;
    }
  }

  @media (min-width: 900px) {
    .settings-layout {
      grid-template-columns: 13.75rem minmax(0, 57rem);
      align-items: start;
      gap: 4rem;
      padding: 6.25rem 2.5rem 4rem;
    }

    .settings-index-title {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }

    .settings-sidebar {
      position: sticky;
      top: 6.25rem;
      display: grid;
      max-height: calc(100dvh - 7.5rem);
      align-content: start;
      gap: 1rem;
      overflow-y: auto;
      padding-bottom: 1.25rem;
      scrollbar-width: thin;
    }
  }
</style>
