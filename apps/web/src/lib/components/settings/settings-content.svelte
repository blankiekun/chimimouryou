<script lang="ts">
  import { browser } from '$app/environment';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import {
    TrackerAutoPause,
    TrackerSkipThresholdAction
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsDimensionPopover from '$lib/components/settings/settings-dimension-popover.svelte';
  import SettingsReadingGoals from '$lib/components/settings/settings-reading-goals.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsLibrarySource from '$lib/components/settings/settings-library-source.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import SettingsStorageSourceList from '$lib/components/settings/settings-storage-source-list.svelte';
  import SettingsUserFontDialog from '$lib/components/settings/settings-user-font-dialog.svelte';
  import { BlurMode } from '$lib/data/blur-mode';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { LocalFont } from '$lib/data/fonts';
  import { FuriganaStyle } from '$lib/data/furigana-style';
  import { knownKanjiMinCount } from '$lib/data/known-furigana';
  import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import { isAppDefault } from '$lib/data/storage/storage-source-manager';
  import { defaultStorageSources } from '$lib/data/storage/storage-types';
  import { isStorageSourceAvailable } from '$lib/data/storage/storage-view';
  import {
    database,
    fontFamilyGroupOne$,
    generatedFurigana$,
    horizontalCustomReadingPosition$,
    textMarginMode$,
    textMarginValue$,
    theme$,
    trackerStartOnOpen$,
    userFonts$,
    verticalCustomReadingPosition$
  } from '$lib/data/store';
  import type { TextMarginMode } from '$lib/data/text-margin-mode';
  import type { VerticalTextOrientation } from '$lib/data/vertical-text-orientation';
  import { ViewMode } from '$lib/data/view-mode';
  import type { WritingMode } from '$lib/data/writing-mode';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import {
    ReplicationSaveBehavior,
    AutoReplicationType
  } from '$lib/functions/replication/replication-options';
  import { t$ } from '$lib/i18n';
  import { map } from 'rxjs';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';

  export let viewMode: ViewMode;

  export let fontFamilyGroupOne: string;

  export let fontFamilyGroupTwo: string;

  export let fontWeight: number | null;

  export let fontSize: number;

  export let lineHeight: number;

  export let textIndentation: number;

  export let textMarginValue: number;

  export let blurImage: boolean;

  export let blurImageMode: string;

  export let hideFurigana: boolean;

  export let furiganaStyle: FuriganaStyle;

  export let writingMode: WritingMode;

  export let enableFontKerning: boolean;

  export let enableFontVPAL: boolean;

  export let verticalTextOrientation: VerticalTextOrientation;

  export let prioritizeReaderStyles: boolean;

  export let enableTextJustification: boolean;

  export let enableTextWrapPretty: boolean;

  export let textMarginMode: TextMarginMode;

  export let enableReaderWakeLock: boolean;

  export let showCharacterCounter: boolean;

  export let showPercentage: boolean;

  export let showFooterChapterCharacterCounter: boolean;

  export let showFooterChapterPercentage: boolean;

  export let secondDimensionMaxValue: number;

  export let firstDimensionMargin: number;

  export let swipeThreshold: number;

  export let disableWheelNavigation: boolean;

  export let autoPositionOnResize: boolean;

  export let avoidPageBreak: boolean;

  export let pauseTrackerOnCustomPointChange: boolean;

  export let customReadingPointEnabled: boolean;

  export let selectionToBookmarkEnabled: boolean;

  export let enableTapEdgeToFlip: boolean;

  export let pageColumns: number;

  export let storageQuota: string;

  export let persistentStorage: boolean;

  export let hideExternalReadHint: boolean;

  export let confirmClose: boolean;

  export let manualBookmark: boolean;

  export let autoBookmark: boolean;

  export let autoBookmarkTime: number;

  export let importHTMLFixMode: string;

  export let restrictImportFixToAnchor: boolean;

  export let cacheStorageData: boolean;

  export let autoReplication: string;

  export let replicationSaveBehavior: string;

  export let showExternalPlaceholder: boolean;

  export let keepLocalStatisticsOnDeletion: boolean;

  export let overwriteBookCompletion: boolean;

  export let startDayHoursForTracker: number;

  export let statisticsMergeMode: string;

  export let readingGoalsMergeMode: string;

  export let statisticsEnabled: boolean;

  export let trackerAutoPause: string;

  export let openTrackerOnCompletion: boolean;

  export let addCharactersOnCompletion: boolean;

  export let trackerAutoStartTime: number;

  export let trackerIdleTime: number;

  export let trackerForwardSkipThreshold: number;

  export let trackerBackwardSkipThreshold: number;

  export let trackerSkipThresholdAction: string;

  export let trackerPopupDetection: boolean;

  export let adjustStatisticsAfterIdleTime: boolean;

  onDestroy(() => dialogManager.dialogs$.next([]));

  $: toggle = [
    { id: false, text: $t$('settings.off') },
    { id: true, text: $t$('settings.on') }
  ] as ToggleOption<boolean>[];

  $: optionsForFuriganaStyle = [
    { id: FuriganaStyle.Hide, text: $t$('prefs.opt.hide') },
    { id: FuriganaStyle.Partial, text: $t$('prefs.opt.partial') },
    { id: FuriganaStyle.Toggle, text: $t$('prefs.opt.toggle') },
    { id: FuriganaStyle.Full, text: $t$('prefs.opt.full') },
    { id: FuriganaStyle.Hover, text: $t$('prefs.opt.hover') },
    { id: FuriganaStyle.Known, text: $t$('prefs.opt.known') }
  ] as ToggleOption<FuriganaStyle>[];

  $: optionsForWritingMode = [
    { id: 'horizontal-tb', text: $t$('prefs.opt.horizontal') },
    { id: 'vertical-rl', text: $t$('prefs.opt.vertical') }
  ] as ToggleOption<WritingMode>[];

  $: optionsForVerticalTextOrientation = [
    { id: 'mixed', text: $t$('prefs.opt.mixed') },
    { id: 'upright', text: $t$('prefs.opt.upright') }
  ] as ToggleOption<VerticalTextOrientation>[];

  $: optionsForTextMarginMode = [
    { id: 'auto', text: $t$('prefs.opt.auto') },
    { id: 'manual', text: $t$('prefs.opt.manual') }
  ] as ToggleOption<TextMarginMode>[];

  $: optionsForViewMode = [
    { id: ViewMode.Continuous, text: $t$('prefs.opt.continuous') },
    { id: ViewMode.Paginated, text: $t$('prefs.opt.paginated') }
  ] as ToggleOption<ViewMode>[];

  $: optionsForBlurMode = [
    { id: BlurMode.ALL, text: $t$('prefs.opt.all') },
    { id: BlurMode.AFTER_TOC, text: $t$('prefs.opt.afterToc') }
  ] as ToggleOption<BlurMode>[];

  $: optionsForImportHTMLFixes = [
    { id: ImportHTMLFixMode.OFF, text: $t$('settings.off') },
    { id: ImportHTMLFixMode.STANDARD, text: $t$('prefs.opt.standard') },
    { id: ImportHTMLFixMode.EXTENDED, text: $t$('prefs.opt.extended') }
  ] as ToggleOption<ImportHTMLFixMode>[];

  $: optionsForAutoReplicationType = [
    { id: AutoReplicationType.Off, text: $t$('settings.off') },
    { id: AutoReplicationType.Up, text: $t$('prefs.opt.up') },
    { id: AutoReplicationType.Down, text: $t$('prefs.opt.down') },
    { id: AutoReplicationType.All, text: $t$('prefs.opt.both') }
  ] as ToggleOption<AutoReplicationType>[];

  $: optionsForReplicationSaveBehavior = [
    { id: ReplicationSaveBehavior.NewOnly, text: $t$('prefs.opt.newOnly') },
    { id: ReplicationSaveBehavior.Overwrite, text: $t$('prefs.opt.overwrite') }
  ] as ToggleOption<ReplicationSaveBehavior>[];

  $: optionsForTrackerAutoPause = [
    { id: TrackerAutoPause.OFF, text: $t$('settings.off') },
    { id: TrackerAutoPause.MODERATE, text: $t$('prefs.opt.moderate') },
    { id: TrackerAutoPause.STRICT, text: $t$('prefs.opt.strict') }
  ] as ToggleOption<TrackerAutoPause>[];

  $: optionsForTrackerSkipThresholdAction = [
    { id: TrackerSkipThresholdAction.IGNORE, text: $t$('prefs.opt.ignore') },
    { id: TrackerSkipThresholdAction.PAUSE, text: $t$('prefs.opt.pauseTracker') }
  ] as ToggleOption<TrackerSkipThresholdAction>[];

  $: optionsForMergeMode = [
    { id: MergeMode.MERGE, text: $t$('prefs.opt.merge') },
    { id: MergeMode.REPLACE, text: $t$('prefs.opt.replace') }
  ] as ToggleOption<MergeMode>[];

  const storageSources$ = database.storageSourcesChanged$.pipe(
    map((storageSources) => [
      ...defaultStorageSources
        .filter((defaultStorageSource) =>
          isStorageSourceAvailable(defaultStorageSource.type, defaultStorageSource.name, window)
        )
        .map((defaultStorageSource) => ({
          name: defaultStorageSource.name,
          type: defaultStorageSource.type,
          storedInManager: false,
          encryptionDisabled: false,
          data: new ArrayBuffer(0),
          lastSourceModified: 0
        })),
      ...storageSources.filter((storageSource) => !isAppDefault(storageSource.name))
    ])
  );

  let showSpinner = false;
  let furiganaStyleTooltip = '';
  let importHTMLFixModeTooltip = '';
  let autoReplicationTypeTooltip = '';
  let trackerAutoPauseTooltip = '';

  $: if ($textMarginMode$ === 'auto') {
    $textMarginValue$ = 0;
  }

  $: verticalTextOrientationTooltip = $t$(
    verticalTextOrientation === 'mixed'
      ? 'prefs.orientationMixedHint'
      : 'prefs.orientationUprightHint'
  );
  $: autoBookmarkTooltip = $t$('prefs.autoBookmarkHint', { seconds: autoBookmarkTime });
  $: wakeLockSupported = browser && 'wakeLock' in navigator;
  $: verticalMode = writingMode === 'vertical-rl';
  $: fontCacheSupported = browser && 'caches' in window;
  $: switch (furiganaStyle) {
    case FuriganaStyle.Hide:
      furiganaStyleTooltip = $t$('prefs.furiganaHideHint');
      break;
    case FuriganaStyle.Toggle:
      furiganaStyleTooltip = $t$('prefs.furiganaToggleHint');
      break;
    case FuriganaStyle.Full:
      furiganaStyleTooltip = $t$('prefs.furiganaFullHint');
      break;
    case FuriganaStyle.Hover:
      furiganaStyleTooltip = $t$('prefs.furiganaHoverHint');
      break;
    case FuriganaStyle.Known:
      furiganaStyleTooltip = $t$('prefs.furiganaKnownHint', { count: knownKanjiMinCount });
      break;
    default:
      furiganaStyleTooltip = $t$('prefs.furiganaPartialHint');
      break;
  }
  $: avoidPageBreakTooltip = $t$(
    avoidPageBreak ? 'prefs.avoidBreakOnHint' : 'prefs.avoidBreakOffHint'
  );
  $: persistentStorageTooltip = $t$(
    persistentStorage ? 'prefs.persistentOnHint' : 'prefs.persistentOffHint'
  );
  $: switch (importHTMLFixMode) {
    case ImportHTMLFixMode.OFF:
      importHTMLFixModeTooltip = $t$('prefs.importFixesOffHint');
      break;
    case ImportHTMLFixMode.EXTENDED:
      importHTMLFixModeTooltip = $t$('prefs.importFixesExtendedHint');
      break;
    default:
      importHTMLFixModeTooltip = $t$('prefs.importFixesStandardHint');
      break;
  }
  $: cacheStorageDataTooltip = $t$(cacheStorageData ? 'prefs.cacheOnHint' : 'prefs.cacheOffHint');
  $: replicationSaveBehaviorTooltip = $t$(
    replicationSaveBehavior === ReplicationSaveBehavior.Overwrite
      ? 'prefs.saveBehaviorOverwriteHint'
      : 'prefs.saveBehaviorNewHint'
  );
  $: switch (autoReplication) {
    case AutoReplicationType.Up:
      autoReplicationTypeTooltip = $t$('prefs.autoSyncUpHint');
      break;
    case AutoReplicationType.Down:
      autoReplicationTypeTooltip = $t$('prefs.autoSyncDownHint');
      break;
    case AutoReplicationType.All:
      autoReplicationTypeTooltip = $t$('prefs.autoSyncAllHint');
      break;
    default:
      autoReplicationTypeTooltip = $t$('prefs.autoSyncOffHint');
      break;
  }
  $: showExternalPlaceholderToolTip = $t$(
    showExternalPlaceholder ? 'prefs.placeholderOnHint' : 'prefs.placeholderOffHint'
  );

  $: startOfDayHours = `${`${startDayHoursForTracker}`.padStart(2, '0')}:00`;

  $: trackerIdleTimeInMin = secondsToMinutes(trackerIdleTime);

  $: switch (trackerAutoPause) {
    case TrackerAutoPause.OFF:
      trackerAutoPauseTooltip = $t$('prefs.autoPauseOffHint');
      break;
    case TrackerAutoPause.STRICT:
      trackerAutoPauseTooltip = $t$('prefs.autoPauseStrictHint');
      break;
    default:
      trackerAutoPauseTooltip = $t$('prefs.autoPauseModerateHint');
      break;
  }

  $: if (browser && !$storageSources$) {
    database
      .getStorageSources()
      .then((storageSources) => {
        database.storageSourcesChanged$.next(storageSources);
      })
      .catch((error) => {
        logger.error(`Failed to retrieve storage sources: ${error.message}`);
        database.storageSourcesChanged$.next([]);
      });
  }
</script>

<SettingsSection id="reader-text">
  <SettingsItemGroup title={$t$('prefs.fontFamily')} tooltip={$t$('prefs.fontFamilyHint')}>
    <span class="font-family">
      <input
        type="text"
        class="app-input"
        list="font-family-one"
        aria-label={$t$('prefs.font1')}
        placeholder="Noto Serif JP"
        bind:value={fontFamilyGroupOne}
      />
      <input
        type="text"
        class="app-input"
        list="font-family-two"
        aria-label={$t$('prefs.font2')}
        placeholder="Noto Sans JP"
        bind:value={fontFamilyGroupTwo}
      />
    </span>
    <!-- The bundled fonts of each group, then the reader's own (Custom fonts) -->
    <datalist id="font-family-one">
      {#each [LocalFont.NOTOSERIFJP, LocalFont.KZUDMINCHO, LocalFont.GENEI, LocalFont.SHIPPORIMINCHO, LocalFont.KLEEONE, LocalFont.KLEEONESEMIBOLD, LocalFont.SERIF] as font (font)}
        <option value={font} />
      {/each}
      {#each $userFonts$ as font (font.path)}
        <option value={font.name} />
      {/each}
    </datalist>
    <datalist id="font-family-two">
      {#each [LocalFont.NOTOSANSJP, LocalFont.KZUDGOTHIC, LocalFont.SANSSERIF] as font (font)}
        <option value={font} />
      {/each}
      {#each $userFonts$ as font (font.path)}
        <option value={font.name} />
      {/each}
    </datalist>
  </SettingsItemGroup>
  {#if fontCacheSupported}
    <SettingsItemGroup title={$t$('prefs.customFont')} tooltip={$t$('prefs.customFontHint')}>
      <button
        type="button"
        class="app-button"
        on:click={() =>
          dialogManager.dialogs$.next([
            {
              component: SettingsUserFontDialog,
              props: { fontFamily: fontFamilyGroupOne$ }
            }
          ])}
      >
        {$t$('prefs.addFont')}
      </button>
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('prefs.fontWeight')} tooltip={$t$('prefs.fontWeightHint')}>
    <input
      type="number"
      placeholder={$t$('prefs.default')}
      class="app-input"
      step="100"
      min="100"
      max="1000"
      bind:value={fontWeight}
      on:change={() => {
        if (fontWeight === null) {
          return;
        }

        if (fontWeight < 100) {
          fontWeight = 100;
        } else if (fontWeight > 1000) {
          fontWeight = 1000;
        }
      }}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.fontSize')}>
    <input type="number" class="app-input" step="1" min="1" bind:value={fontSize} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.lineHeight')}>
    <input
      type="number"
      class="app-input"
      step="0.05"
      min="1"
      bind:value={lineHeight}
      on:change={() => {
        if (!lineHeight || lineHeight < 1) {
          lineHeight = 1.65;
        }
      }}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.indent')} tooltip={$t$('prefs.indentHint')}>
    <input
      type="number"
      class="app-input"
      step=".5"
      min="0"
      bind:value={textIndentation}
      on:blur={() => {
        const newValue = Number.parseFloat(`${textIndentation ?? 0}`);

        if (isNaN(newValue) || newValue < 1) {
          textIndentation = 0;
        }
      }}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.marginMode')} tooltip={$t$('prefs.marginModeHint')}>
    <ButtonToggleGroup options={optionsForTextMarginMode} bind:selectedOptionId={textMarginMode} />
  </SettingsItemGroup>
  {#if textMarginMode === 'manual'}
    <SettingsItemGroup title={$t$('prefs.margins')} tooltip={$t$('prefs.marginsHint')}>
      <input
        type="number"
        class="app-input"
        step=".5"
        min="0"
        bind:value={textMarginValue}
        on:blur={() => {
          const newValue = Number.parseFloat(`${textMarginValue ?? 0}`);

          if (isNaN(newValue) || newValue < 1) {
            textMarginValue = 0;
          }
        }}
      />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('prefs.justify')} tooltip={$t$('prefs.justifyHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={enableTextJustification} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.wrapPretty')} tooltip={$t$('prefs.wrapPrettyHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={enableTextWrapPretty} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.prioritize')} tooltip={$t$('prefs.prioritizeHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={prioritizeReaderStyles} />
  </SettingsItemGroup>
</SettingsSection>
<SettingsSection id="reader-writing">
  <SettingsItemGroup title={$t$('prefs.writingMode')}>
    <ButtonToggleGroup options={optionsForWritingMode} bind:selectedOptionId={writingMode} />
  </SettingsItemGroup>
  {#if verticalMode}
    <SettingsItemGroup title={$t$('prefs.kerning')} tooltip={$t$('prefs.kerningHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={enableFontKerning} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.vpal')} tooltip={$t$('prefs.vpalHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={enableFontVPAL} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.orientation')} tooltip={verticalTextOrientationTooltip}>
      <ButtonToggleGroup
        options={optionsForVerticalTextOrientation}
        bind:selectedOptionId={verticalTextOrientation}
      />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('prefs.hideFurigana')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={hideFurigana} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title={$t$('prefs.generatedFurigana')}
    tooltip={$t$('prefs.generatedFuriganaHint')}
  >
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={$generatedFurigana$} />
  </SettingsItemGroup>
  {#if hideFurigana}
    <SettingsItemGroup title={$t$('prefs.furiganaStyle')} tooltip={furiganaStyleTooltip}>
      <ButtonToggleGroup options={optionsForFuriganaStyle} bind:selectedOptionId={furiganaStyle} />
    </SettingsItemGroup>
  {/if}
</SettingsSection>
<SettingsSection id="reader-layout">
  <SettingsItemGroup title={$t$('prefs.viewMode')}>
    <ButtonToggleGroup options={optionsForViewMode} bind:selectedOptionId={viewMode} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$(verticalMode ? 'prefs.marginLeftRight' : 'prefs.marginTopBottom')}>
    <SettingsDimensionPopover
      slot="header"
      isFirstDimension
      isVertical={verticalMode}
      bind:dimensionValue={firstDimensionMargin}
    />
    <input type="number" class="app-input" step="1" min="0" bind:value={firstDimensionMargin} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$(verticalMode ? 'prefs.maxHeight' : 'prefs.maxWidth')}>
    <SettingsDimensionPopover
      slot="header"
      isVertical={verticalMode}
      bind:dimensionValue={secondDimensionMaxValue}
    />
    <input type="number" class="app-input" step="1" min="0" bind:value={secondDimensionMaxValue} />
  </SettingsItemGroup>
  {#if viewMode !== ViewMode.Continuous}
    <SettingsItemGroup title={$t$('prefs.avoidBreak')} tooltip={avoidPageBreakTooltip}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={avoidPageBreak} />
    </SettingsItemGroup>
    {#if !verticalMode}
      <SettingsItemGroup title={$t$('prefs.columns')} tooltip={$t$('prefs.columnsHint')}>
        <input type="number" class="app-input" step="1" min="0" bind:value={pageColumns} />
      </SettingsItemGroup>
    {/if}
  {/if}
  <SettingsItemGroup title={$t$('prefs.blur')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={blurImage} />
  </SettingsItemGroup>
  {#if blurImage}
    <SettingsItemGroup title={$t$('prefs.blurMode')} tooltip={$t$('prefs.blurModeHint')}>
      <ButtonToggleGroup options={optionsForBlurMode} bind:selectedOptionId={blurImageMode} />
    </SettingsItemGroup>
  {/if}
</SettingsSection>
<SettingsSection id="reader-progress">
  <SettingsItemGroup title={$t$('prefs.charCounter')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={showCharacterCounter} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.percentage')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={showPercentage} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.chapterChars')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={showFooterChapterCharacterCounter} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.chapterPercentage')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={showFooterChapterPercentage} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.manualBookmark')} tooltip={$t$('prefs.manualBookmarkHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={manualBookmark} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.autoBookmark')} tooltip={autoBookmarkTooltip}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={autoBookmark} />
  </SettingsItemGroup>
  {#if autoBookmark}
    <SettingsItemGroup
      title={$t$('prefs.autoBookmarkTime')}
      tooltip={$t$('prefs.autoBookmarkTimeHint')}
    >
      <input
        type="number"
        step="1"
        min="1"
        class="app-input"
        bind:value={autoBookmarkTime}
        on:blur={() => {
          if (autoBookmarkTime < 1 || typeof autoBookmarkTime !== 'number') {
            autoBookmarkTime = 3;
          }
        }}
      />
    </SettingsItemGroup>
  {/if}
  {#if viewMode === ViewMode.Continuous}
    <SettingsItemGroup title={$t$('prefs.readingPoint')} tooltip={$t$('prefs.readingPointHint')}>
      <div class="flex items-center">
        <ButtonToggleGroup options={toggle} bind:selectedOptionId={customReadingPointEnabled} />
        {#if customReadingPointEnabled}
          <button
            type="button"
            class="app-button app-button-quiet ml-4"
            on:click={() => {
              verticalCustomReadingPosition$.next(100);
              horizontalCustomReadingPosition$.next(0);
            }}
          >
            {$t$('prefs.resetPoints')}
          </button>
        {/if}
      </div>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.autoPosition')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={autoPositionOnResize} />
    </SettingsItemGroup>
  {:else}
    <SettingsItemGroup
      title={$t$('prefs.selectionBookmark')}
      tooltip={$t$('prefs.selectionBookmarkHint')}
    >
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={selectionToBookmarkEnabled} />
    </SettingsItemGroup>
  {/if}
</SettingsSection>
<SettingsSection id="reader-navigation">
  <SettingsItemGroup title={$t$('prefs.swipe')} tooltip={$t$('prefs.swipeHint')}>
    <input
      type="number"
      step="1"
      min="10"
      class="app-input"
      bind:value={swipeThreshold}
      on:blur={() => {
        if (swipeThreshold < 10 || typeof swipeThreshold !== 'number') {
          swipeThreshold = 10;
        }
      }}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.noWheel')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={disableWheelNavigation} />
  </SettingsItemGroup>
  {#if viewMode !== ViewMode.Continuous}
    <SettingsItemGroup title={$t$('prefs.tapFlip')} tooltip={$t$('prefs.tapFlipHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={enableTapEdgeToFlip} />
    </SettingsItemGroup>
  {/if}
</SettingsSection>
<SettingsSection id="reader-session">
  {#if wakeLockSupported}
    <SettingsItemGroup title={$t$('prefs.wakeLock')} tooltip={$t$('prefs.wakeLockHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={enableReaderWakeLock} />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('prefs.confirmClose')} tooltip={$t$('prefs.confirmCloseHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={confirmClose} />
  </SettingsItemGroup>
</SettingsSection>
<SettingsSection id="tracking-statistics">
  <SettingsItemGroup title={$t$('prefs.statistics')} tooltip={$t$('prefs.statisticsHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={statisticsEnabled} />
  </SettingsItemGroup>
  {#if statisticsEnabled}
    <SettingsItemGroup title={$t$('prefs.pointPauses')} tooltip={$t$('prefs.pointPausesHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={pauseTrackerOnCustomPointChange} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.autoPause')} tooltip={trackerAutoPauseTooltip}>
      <ButtonToggleGroup
        options={optionsForTrackerAutoPause}
        bind:selectedOptionId={trackerAutoPause}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.openOnCompletion')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={openTrackerOnCompletion} />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t$('prefs.updateOnCompletion')}
      tooltip={$t$('prefs.updateOnCompletionHint')}
    >
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={addCharactersOnCompletion} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.startOnOpen')} tooltip={$t$('prefs.startOnOpenHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={$trackerStartOnOpen$} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.autostart')} tooltip={$t$('prefs.autostartHint')}>
      <input
        type="number"
        class="app-input"
        step="1"
        min="0"
        bind:value={trackerAutoStartTime}
        on:blur={() => {
          const newValue = Number.parseFloat(`${trackerAutoStartTime ?? 0}`);

          if (isNaN(newValue) || newValue < 1) {
            trackerAutoStartTime = 0;
          }
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.idle')} tooltip={$t$('prefs.idleHint')}>
      <input
        type="number"
        class="app-input"
        step="0.5"
        min="0"
        bind:value={trackerIdleTimeInMin}
        on:blur={() => {
          if (!trackerIdleTimeInMin || trackerIdleTimeInMin < 0) {
            trackerIdleTime = 0;
          } else if (trackerIdleTimeInMin > 43200) {
            trackerIdleTime = 900;
          } else {
            trackerIdleTime = Math.floor(trackerIdleTimeInMin * 60);
          }
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.forwardSkip')} tooltip={$t$('prefs.forwardSkipHint')}>
      <input
        type="number"
        class="app-input"
        step="1"
        min="0"
        bind:value={trackerForwardSkipThreshold}
        on:blur={() => {
          if (trackerForwardSkipThreshold === 0) {
            trackerForwardSkipThreshold = 0;
          } else if (!trackerForwardSkipThreshold || trackerForwardSkipThreshold < 0) {
            trackerForwardSkipThreshold = 2700;
          }
        }}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('prefs.backwardSkip')} tooltip={$t$('prefs.backwardSkipHint')}>
      <input
        type="number"
        class="app-input"
        step="1"
        bind:value={trackerBackwardSkipThreshold}
        on:blur={() => {
          if (trackerBackwardSkipThreshold < 0) {
            trackerBackwardSkipThreshold = Math.abs(trackerBackwardSkipThreshold);
          } else if (trackerBackwardSkipThreshold === 0) {
            trackerBackwardSkipThreshold = 0;
          } else if (!trackerBackwardSkipThreshold) {
            trackerBackwardSkipThreshold = 2700;
          }
        }}
      />
    </SettingsItemGroup>
    {#if trackerForwardSkipThreshold || trackerBackwardSkipThreshold}
      <SettingsItemGroup
        title={$t$('prefs.thresholdAction')}
        tooltip={$t$('prefs.thresholdActionHint')}
      >
        <ButtonToggleGroup
          options={optionsForTrackerSkipThresholdAction}
          bind:selectedOptionId={trackerSkipThresholdAction}
        />
      </SettingsItemGroup>
    {/if}
    {#if trackerAutoPause !== TrackerAutoPause.OFF}
      <SettingsItemGroup title={$t$('prefs.dictionary')} tooltip={$t$('prefs.dictionaryHint')}>
        <ButtonToggleGroup options={toggle} bind:selectedOptionId={trackerPopupDetection} />
      </SettingsItemGroup>
    {/if}
    {#if trackerIdleTime > 0}
      <SettingsItemGroup title={$t$('prefs.rollback')} tooltip={$t$('prefs.rollbackHint')}>
        <ButtonToggleGroup options={toggle} bind:selectedOptionId={adjustStatisticsAfterIdleTime} />
      </SettingsItemGroup>
    {/if}
  {/if}
</SettingsSection>
<SettingsSection id="tracking-day">
  <SettingsItemGroup
    title={$t$('prefs.dayStart', { time: startOfDayHours })}
    tooltip={$t$('prefs.dayStartHint')}
  >
    <input
      type="range"
      step="1"
      min="0"
      max="23"
      class="app-input"
      bind:value={startDayHoursForTracker}
    />
  </SettingsItemGroup>
  <SettingsItemGroup
    title={$t$('prefs.overwriteCompletion')}
    tooltip={$t$('prefs.overwriteCompletionHint')}
  >
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={overwriteBookCompletion} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.keepLocal')} tooltip={$t$('prefs.keepLocalHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={keepLocalStatisticsOnDeletion} />
  </SettingsItemGroup>
  <div class="settings-danger-zone" role="group" aria-label={$t$('prefs.dangerZone')}>
    <p class="settings-danger-zone-label">{$t$('prefs.dangerZone')}</p>
    <SettingsItemGroup title={$t$('prefs.zombie')} tooltip={$t$('prefs.zombieHint')}>
      <button
        type="button"
        class="app-button app-button-danger"
        on:click={() => {
          if (!window.confirm($t$('prefs.zombieConfirm'))) {
            return;
          }

          showSpinner = true;
          database
            .clearZombieStatistics()
            .catch(({ message }) =>
              dialogManager.dialogs$.next([
                {
                  component: MessageDialog,
                  props: {
                    title: $t$('prefs.error'),
                    message: $t$('prefs.zombieError', { message })
                  }
                }
              ])
            )
            .finally(() => (showSpinner = false));
        }}
      >
        {$t$('prefs.clear')}
      </button>
    </SettingsItemGroup>
  </div>
</SettingsSection>
<SettingsSection id="tracking-merge">
  <SettingsItemGroup
    title={$t$('prefs.statisticsMerge')}
    tooltip={$t$('prefs.statisticsMergeHint')}
  >
    <ButtonToggleGroup options={optionsForMergeMode} bind:selectedOptionId={statisticsMergeMode} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.goalsMerge')} tooltip={$t$('prefs.goalsMergeHint')}>
    <ButtonToggleGroup
      options={optionsForMergeMode}
      bind:selectedOptionId={readingGoalsMergeMode}
    />
  </SettingsItemGroup>
</SettingsSection>
<SettingsSection id="tracking-goals" wide>
  {#if statisticsEnabled}
    <div class="settings-panel" data-settings-item data-settings-search={$t$('prefs.goalsSearch')}>
      <SettingsReadingGoals
        storageSources={$storageSources$}
        on:spinner={({ detail }) => (showSpinner = detail)}
      />
    </div>
  {:else}
    <SettingsItemGroup title={$t$('prefs.goals')} wide>
      {$t$('prefs.goalsOff')}
    </SettingsItemGroup>
  {/if}
</SettingsSection>
<SettingsSection id="data-storage">
  <SettingsItemGroup title={$t$('prefs.persistent')} tooltip={persistentStorageTooltip}>
    <div class="flex items-center">
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={persistentStorage} />
      {#if storageQuota}
        <span class="ml-4 text-sm text-[color:var(--app-muted-fg)]">{storageQuota}</span>
      {/if}
    </div>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.cache')} tooltip={cacheStorageDataTooltip}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={cacheStorageData} />
  </SettingsItemGroup>
  <SettingsLibrarySource />
</SettingsSection>
<SettingsSection id="data-import">
  <SettingsItemGroup title={$t$('prefs.importFixes')} tooltip={importHTMLFixModeTooltip}>
    <ButtonToggleGroup
      options={optionsForImportHTMLFixes}
      bind:selectedOptionId={importHTMLFixMode}
    />
  </SettingsItemGroup>
  {#if importHTMLFixMode !== ImportHTMLFixMode.OFF}
    <SettingsItemGroup title={$t$('prefs.restrictLinks')} tooltip={$t$('prefs.restrictLinksHint')}>
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={restrictImportFixToAnchor} />
    </SettingsItemGroup>
  {/if}
</SettingsSection>
<SettingsSection id="data-sync">
  <SettingsItemGroup title={$t$('prefs.autoSync')} tooltip={autoReplicationTypeTooltip}>
    <ButtonToggleGroup
      options={optionsForAutoReplicationType}
      bind:selectedOptionId={autoReplication}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.saveBehavior')} tooltip={replicationSaveBehaviorTooltip}>
    <ButtonToggleGroup
      options={optionsForReplicationSaveBehavior}
      bind:selectedOptionId={replicationSaveBehavior}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.placeholder')} tooltip={showExternalPlaceholderToolTip}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={showExternalPlaceholder} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('prefs.hideSourceHint')} tooltip={$t$('prefs.hideSourceHintHint')}>
    <ButtonToggleGroup options={toggle} bind:selectedOptionId={hideExternalReadHint} />
  </SettingsItemGroup>
</SettingsSection>
<SettingsSection id="data-sources" wide>
  <div class="settings-panel" data-settings-item data-settings-search={$t$('prefs.sourcesSearch')}>
    <SettingsStorageSourceList storageSources={$storageSources$} />
  </div>
</SettingsSection>
{#if showSpinner}
  <div class="tap-highlight-transparent fixed inset-0 bg-overlay" />
  <div class="fixed inset-0 flex h-full w-full items-center justify-center text-7xl">
    <Fa icon={faSpinner} spin />
  </div>
{/if}

<style>
  .font-family {
    display: grid;
    gap: 0.5rem;
  }

  .settings-panel {
    min-width: 0;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }
</style>
