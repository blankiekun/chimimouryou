<script lang="ts">
  /**
   * Settings → Dictionary lookups: the built-in dictionary's settings in Yomitan's own sections
   * and options shape (lib/data/dictionary.ts). Popup, Scanning, Audio and Shortcuts are in
   * settings-dictionary-popup.svelte. Not part of upstream.
   */
  import { faArrowDown, faArrowUp } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import InstallDictionary from '$lib/components/dictionary/install-dictionary.svelte';
  import DictionaryCollectionImport from '$lib/components/settings/dictionary-collection-import.svelte';
  import {
    builtInLookups$,
    builtInLookupsChoice$,
    deleteAllDictionaries,
    deleteDictionary,
    dictionaries$,
    exportYomitanSettings,
    importDictionary,
    importYomitanSettings,
    loadYomitanOptions,
    moveDictionary,
    profileOptions,
    refreshDictionaries,
    resetYomitanSettings,
    setDictionaryOptions,
    updateProfileOptions,
    yomitanOptions$
  } from '$lib/data/dictionary';
  import { yomitanSeen$ } from '$lib/data/yomitan';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { t$ } from '$lib/i18n';
  import type { DictionaryOptions, ProfileOptions } from '$lib/vendor/yomitan/types/settings';

  const jitenFrequencyLists = 'https://jiten.moe/frequency-dictionaries';

  let loadError = '';
  /** The installed dictionaries are known (refreshDictionaries) */
  let listed = false;
  let importing: { name: string; done: number; total: number } | undefined;
  let importErrors: string[] = [];
  let confirming = '';
  let backupMessage = '';
  let backupError = '';

  onMount(() => {
    loadYomitanOptions()
      .then(() => refreshDictionaries())
      .then(() => (listed = true))
      .catch((error) => (loadError = error.message));
  });

  $: profile = $yomitanOptions$ ? profileOptions($yomitanOptions$) : undefined;
  $: summaries = new Map($dictionaries$.map((summary) => [summary.title, summary]));
  $: enabledCount = profile?.dictionaries.filter(({ enabled }) => enabled).length ?? 0;
  $: frequencyDictionaries = $dictionaries$.filter((summary) => summary.counts?.termMeta.freq);

  $: resultModes = [
    ['split', $t$('dict.resultSplit')],
    ['group', $t$('dict.resultGroup')],
    ['term', $t$('dict.resultTerm')],
    ['merge', $t$('dict.resultMerge')]
  ];
  $: resolutions = [
    { id: 'letter', text: $t$('dict.resolutionLetter') },
    { id: 'word', text: $t$('dict.resolutionWord') }
  ] as ToggleOption<string>[];
  $: sortOrders = [
    { id: 'descending', text: $t$('dict.sortDescending') },
    { id: 'ascending', text: $t$('dict.sortAscending') }
  ] as ToggleOption<string>[];
  $: collapsible = [
    ['not-collapsible', $t$('dict.collapseNever')],
    ['expanded', $t$('dict.collapseExpanded')],
    ['collapsed', $t$('dict.collapseCollapsed')],
    ['force-collapsed', $t$('dict.collapseForceCollapsed')],
    ['force-expanded', $t$('dict.collapseForceExpanded')]
  ];

  // Segmented controls bind to these; a change is written back to the options.
  let resolution = '';
  let sortOrder = '';
  $: if (profile) syncFromProfile(profile);
  $: if (profile && resolution && resolution !== profile.translation.searchResolution) {
    set(
      (p) =>
        (p.translation.searchResolution =
          resolution as ProfileOptions['translation']['searchResolution'])
    );
  }
  $: if (profile && sortOrder && sortOrder !== profile.general.sortFrequencyDictionaryOrder) {
    set(
      (p) =>
        (p.general.sortFrequencyDictionaryOrder =
          sortOrder as ProfileOptions['general']['sortFrequencyDictionaryOrder'])
    );
  }

  function syncFromProfile(options: ProfileOptions) {
    resolution = options.translation.searchResolution;
    sortOrder = options.general.sortFrequencyDictionaryOrder;
  }

  function setResultMode(value: string) {
    set(
      (p) => (p.general.resultOutputMode = value as ProfileOptions['general']['resultOutputMode'])
    );
  }

  function set(change: (options: ProfileOptions) => void) {
    return updateProfileOptions(change);
  }

  function setLookups(on: boolean) {
    builtInLookupsChoice$.next(on);
  }

  async function importFiles(files: FileList) {
    importErrors = [];
    for (const file of Array.from(files)) {
      importing = { name: file.name, done: 0, total: 0 };
      try {
        const { errors } = await importDictionary(file, (done, total) => {
          importing = { name: file.name, done, total };
        });
        importErrors = [...importErrors, ...errors.map((error) => `${file.name}: ${error}`)];
      } catch (error: any) {
        importErrors = [...importErrors, `${file.name}: ${error.message}`];
      }
    }
    importing = undefined;
  }

  async function confirmed(id: string, action: () => Promise<unknown>) {
    if (confirming !== id) {
      confirming = id;
      return;
    }
    confirming = '';
    try {
      await action();
    } catch (error: any) {
      loadError = error.message;
    }
  }

  function dictionaryMeta(name: string) {
    const counts = summaries.get(name)?.counts;
    const revision = summaries.get(name)?.revision;
    const parts = [revision ? $t$('dict.revision', { revision }) : ''];
    if (counts?.terms.total) parts.push($t$('dict.terms', { count: counts.terms.total }));
    if (counts?.termMeta.freq) parts.push($t$('dict.frequencies'));
    if (counts?.termMeta.pitch) parts.push($t$('dict.pitch'));
    if (counts?.kanji.total) parts.push($t$('dict.kanji', { count: counts.kanji.total }));
    return parts.filter(Boolean).join(' · ');
  }

  function setDictionary(name: string, change: Partial<DictionaryOptions>) {
    setDictionaryOptions(name, change);
  }

  function setCollapsible(name: string, value: string) {
    setDictionary(name, {
      definitionsCollapsible: value as DictionaryOptions['definitionsCollapsible']
    });
  }

  const dictionaryToggles = [
    ['allowSecondarySearches', 'dict.secondarySearches', 'dict.secondarySearchesHint'],
    ['partsOfSpeechFilter', 'dict.posFilter', 'dict.posFilterHint'],
    ['useDeinflections', 'dict.deinflections', 'dict.deinflectionsHint']
  ] as const;

  async function exportSettings() {
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([await exportYomitanSettings()], { type: 'application/json' }),
      `yomitan-settings-${date}.json`
    );
  }

  async function importSettings(files: FileList) {
    backupMessage = '';
    backupError = '';
    try {
      await importYomitanSettings(await files[0].text());
      backupMessage = $t$('dict.importedSettings');
    } catch (error: any) {
      backupError = $t$('dict.importSettingsFailed', { error: error.message });
    }
  }

  function setReplacement(index: number, change: Record<string, unknown>) {
    set((p) => {
      const group = [...(p.translation.textReplacements.groups[0] ?? [])];
      group[index] = { ...group[index], ...change };
      p.translation.textReplacements.groups = [
        group,
        ...p.translation.textReplacements.groups.slice(1)
      ];
    });
  }

  function addReplacement() {
    set((p) => {
      const group = [...(p.translation.textReplacements.groups[0] ?? [])];
      group.push({ pattern: '', ignoreCase: false, replacement: '' });
      p.translation.textReplacements.groups = [
        group,
        ...p.translation.textReplacements.groups.slice(1)
      ];
    });
  }

  function removeReplacement(index: number) {
    set((p) => {
      const group = (p.translation.textReplacements.groups[0] ?? []).filter((_, i) => i !== index);
      p.translation.textReplacements.groups = [
        group,
        ...p.translation.textReplacements.groups.slice(1)
      ];
    });
  }
</script>

<SettingsSection id="dictionary-general" keywords="yomitan popup lookup dictionary 辞書">
  <SettingsItemGroup title={$t$('dict.builtIn')} tooltip={$t$('dict.builtInHint')}>
    <button
      type="button"
      role="switch"
      class="app-switch"
      aria-checked={$builtInLookups$}
      aria-label={$t$('dict.builtIn')}
      on:click={() => setLookups(!$builtInLookups$)}
    >
      <span class="app-switch-thumb" />
      <span class="app-switch-text">{$t$($builtInLookups$ ? 'settings.on' : 'settings.off')}</span>
    </button>
    <svelte:fragment slot="after">
      {#if $yomitanSeen$ && $builtInLookups$}
        <p class="dict-note" role="status">{$t$('dict.yomitanSeenOn')}</p>
      {:else if $yomitanSeen$ && $builtInLookupsChoice$ === null}
        <p class="dict-note" role="status">{$t$('dict.yomitanSeenOff')}</p>
      {:else if $builtInLookups$ && listed && !$dictionaries$.length}
        <p class="dict-note" role="status">{$t$('dict.noneYet')}</p>
        <InstallDictionary />
      {/if}
    </svelte:fragment>
  </SettingsItemGroup>
  {#if profile}
    <SettingsItemGroup title={$t$('dict.resultMode')} tooltip={$t$('dict.resultModeHint')}>
      <select
        class="app-input"
        aria-label={$t$('dict.resultMode')}
        value={profile.general.resultOutputMode}
        on:change={(event) => setResultMode(event.currentTarget.value)}
      >
        {#each resultModes as [id, text]}
          <option value={id}>{text}</option>
        {/each}
      </select>
    </SettingsItemGroup>
    {#if profile.general.resultOutputMode === 'merge'}
      <SettingsItemGroup
        title={$t$('dict.mainDictionary')}
        tooltip={$t$('dict.mainDictionaryHint')}
      >
        <select
          class="app-input"
          aria-label={$t$('dict.mainDictionary')}
          value={profile.general.mainDictionary}
          on:change={(event) => set((p) => (p.general.mainDictionary = event.currentTarget.value))}
        >
          <option value="">{$t$('dict.none')}</option>
          {#each profile.dictionaries as { name, alias } (name)}
            <option value={name}>{alias}</option>
          {/each}
        </select>
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t$('dict.maxResults')} tooltip={$t$('dict.maxResultsHint')}>
      <input
        class="app-input dict-number"
        type="number"
        min="1"
        step="1"
        aria-label={$t$('dict.maxResults')}
        value={profile.general.maxResults}
        on:change={(event) => {
          const value = Math.max(1, Math.round(+event.currentTarget.value || 1));
          set((p) => (p.general.maxResults = value));
        }}
      />
    </SettingsItemGroup>
  {/if}
</SettingsSection>

<SettingsSection
  id="dictionary-dictionaries"
  keywords="import jmdict jitendex frequency pitch zip"
  count={profile ? profile.dictionaries.length : undefined}
  wide
>
  {#if loadError}
    <p class="dict-error" role="alert">{loadError}</p>
  {/if}
  <div class="dict-import">
    <p class="dict-lead">{$t$('dict.importLead')}</p>
    <ul class="dict-downloads">
      <li class="dict-download">
        <span class="dict-name">
          <span class="dict-title">JMdict</span>
          <span class="dict-meta">{$t$('dict.jmdictHint')}</span>
        </span>
        <InstallDictionary />
      </li>
      <li class="dict-download">
        <span class="dict-name">
          <span class="dict-title">Jiten frequency list</span>
          <span class="dict-meta">{$t$('dict.jitenFreqHint')}</span>
        </span>
        <a
          class="app-button app-button-quiet"
          href={jitenFrequencyLists}
          target="_blank"
          rel="noreferrer">{$t$('dict.getJitenFreq')}</a
        >
      </li>
    </ul>
    <label class="app-button app-button-primary dict-file" class:dict-disabled={!!importing}>
      <input
        type="file"
        accept=".zip,application/zip"
        multiple
        hidden
        disabled={!!importing}
        use:inputFile={importFiles}
      />
      {$t$('dict.import')}
    </label>
    {#if importing}
      <div
        class="dict-track"
        role="progressbar"
        aria-label={$t$('dict.importing', { name: importing.name })}
        aria-valuemin={0}
        aria-valuemax={importing.total}
        aria-valuenow={importing.done}
      >
        <div
          class="dict-fill"
          style:width="{importing.total ? (importing.done / importing.total) * 100 : 0}%"
        />
      </div>
      <p class="dict-note">{$t$('dict.importing', { name: importing.name })}</p>
    {/if}
    {#each importErrors as error}
      <p class="dict-error" role="alert">{error}</p>
    {/each}
  </div>

  {#if profile}
    {#if profile.dictionaries.length}
      <p class="dict-note">
        {$t$('dict.enabledCount', { enabled: enabledCount, count: profile.dictionaries.length })}
      </p>
      <ol class="dict-list">
        {#each profile.dictionaries as dictionary, index (dictionary.name)}
          <li class="dict-row">
            <div class="dict-head">
              <span class="dict-index">{index + 1}</span>
              <span class="dict-name">
                <span class="dict-title">{dictionary.alias || dictionary.name}</span>
                <span class="dict-meta">{dictionaryMeta(dictionary.name)}</span>
              </span>
              <span class="dict-move">
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  aria-label={$t$('dict.moveUp', { name: dictionary.alias })}
                  disabled={index === 0}
                  on:click={() => moveDictionary(dictionary.name, -1)}
                >
                  <Fa icon={faArrowUp} />
                </button>
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  aria-label={$t$('dict.moveDown', { name: dictionary.alias })}
                  disabled={index === profile.dictionaries.length - 1}
                  on:click={() => moveDictionary(dictionary.name, 1)}
                >
                  <Fa icon={faArrowDown} />
                </button>
              </span>
              <button
                type="button"
                role="switch"
                class="app-switch"
                aria-checked={dictionary.enabled}
                aria-label={$t$('dict.enable', { name: dictionary.alias })}
                on:click={() => setDictionary(dictionary.name, { enabled: !dictionary.enabled })}
              >
                <span class="app-switch-thumb" />
                <span class="app-switch-text">
                  {$t$(dictionary.enabled ? 'settings.on' : 'settings.off')}
                </span>
              </button>
            </div>
            <details class="dict-details">
              <summary>{$t$('dict.options')}</summary>
              <div class="dict-options">
                <label class="dict-field">
                  <span>{$t$('dict.alias')}</span>
                  <input
                    class="app-input"
                    value={dictionary.alias}
                    on:change={(event) =>
                      setDictionary(dictionary.name, {
                        alias: event.currentTarget.value.trim() || dictionary.name
                      })}
                  />
                </label>
                {#each dictionaryToggles as [key, label, hint]}
                  <div class="dict-option">
                    <span class="dict-option-text">
                      <span>{$t$(label)}</span>
                      <span class="dict-meta">{$t$(hint)}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      class="app-switch"
                      aria-checked={dictionary[key]}
                      aria-label={$t$(label)}
                      on:click={() => setDictionary(dictionary.name, { [key]: !dictionary[key] })}
                    >
                      <span class="app-switch-thumb" />
                    </button>
                  </div>
                {/each}
                <label class="dict-field">
                  <span>{$t$('dict.collapsible')}</span>
                  <select
                    class="app-input"
                    value={dictionary.definitionsCollapsible}
                    on:change={(event) =>
                      setCollapsible(dictionary.name, event.currentTarget.value)}
                  >
                    {#each collapsible as [id, text]}
                      <option value={id}>{text}</option>
                    {/each}
                  </select>
                </label>
                <span class="dict-actions">
                  <button
                    type="button"
                    class="app-button app-button-danger"
                    on:click={() =>
                      confirmed(`delete:${dictionary.name}`, () =>
                        deleteDictionary(dictionary.name)
                      )}
                  >
                    {confirming === `delete:${dictionary.name}`
                      ? $t$('dict.deleteConfirm')
                      : $t$('dict.delete')}
                  </button>
                  {#if confirming === `delete:${dictionary.name}`}
                    <button
                      type="button"
                      class="app-button app-button-quiet"
                      on:click={() => (confirming = '')}
                    >
                      {$t$('dict.cancel')}
                    </button>
                  {/if}
                </span>
              </div>
            </details>
          </li>
        {/each}
      </ol>
    {:else if !importing}
      <p class="dict-note">{$t$('dict.empty')}</p>
    {/if}

    {#if frequencyDictionaries.length}
      <SettingsItemGroup title={$t$('dict.sortFrequency')} tooltip={$t$('dict.sortFrequencyHint')}>
        <select
          class="app-input"
          aria-label={$t$('dict.sortFrequency')}
          value={profile.general.sortFrequencyDictionary ?? ''}
          on:change={(event) =>
            set((p) => (p.general.sortFrequencyDictionary = event.currentTarget.value || null))}
        >
          <option value="">{$t$('dict.none')}</option>
          {#each frequencyDictionaries as { title } (title)}
            <option value={title}>{title}</option>
          {/each}
        </select>
      </SettingsItemGroup>
      {#if profile.general.sortFrequencyDictionary}
        <SettingsItemGroup title={$t$('dict.sortOrder')}>
          <ButtonToggleGroup options={sortOrders} bind:selectedOptionId={sortOrder} />
        </SettingsItemGroup>
      {/if}
    {/if}

    {#if profile.dictionaries.length}
      <span class="dict-actions">
        <button
          type="button"
          class="app-button app-button-danger"
          on:click={() => confirmed('deleteAll', deleteAllDictionaries)}
        >
          {confirming === 'deleteAll' ? $t$('dict.deleteAllConfirm') : $t$('dict.deleteAll')}
        </button>
        {#if confirming === 'deleteAll'}
          <button
            type="button"
            class="app-button app-button-quiet"
            on:click={() => (confirming = '')}
          >
            {$t$('dict.cancel')}
          </button>
        {/if}
      </span>
    {/if}
  {/if}
</SettingsSection>

{#if profile}
  <SettingsSection id="dictionary-translation" keywords="deinflection replacement alphanumeric">
    <SettingsItemGroup title={$t$('dict.resolution')} tooltip={$t$('dict.resolutionHint')}>
      <ButtonToggleGroup options={resolutions} bind:selectedOptionId={resolution} />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.alphanumeric')} tooltip={$t$('dict.alphanumericHint')}>
      <button
        type="button"
        role="switch"
        class="app-switch"
        aria-checked={profile.scanning.alphanumeric}
        aria-label={$t$('dict.alphanumeric')}
        on:click={() => set((p) => (p.scanning.alphanumeric = !p.scanning.alphanumeric))}
      >
        <span class="app-switch-thumb" />
        <span class="app-switch-text">
          {$t$(profile.scanning.alphanumeric ? 'settings.on' : 'settings.off')}
        </span>
      </button>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.replacements')} tooltip={$t$('dict.replacementsHint')} wide>
      <div class="dict-option">
        <span class="dict-option-text"><span>{$t$('dict.searchOriginal')}</span></span>
        <button
          type="button"
          role="switch"
          class="app-switch"
          aria-checked={profile.translation.textReplacements.searchOriginal}
          aria-label={$t$('dict.searchOriginal')}
          on:click={() =>
            set(
              (p) =>
                (p.translation.textReplacements.searchOriginal =
                  !p.translation.textReplacements.searchOriginal)
            )}
        >
          <span class="app-switch-thumb" />
        </button>
      </div>
      {#each profile.translation.textReplacements.groups[0] ?? [] as replacement, index}
        <div class="dict-replacement">
          <input
            class="app-input"
            aria-label={$t$('dict.pattern')}
            placeholder={$t$('dict.pattern')}
            value={replacement.pattern}
            on:change={(event) => setReplacement(index, { pattern: event.currentTarget.value })}
          />
          <input
            class="app-input"
            aria-label={$t$('dict.replacement')}
            placeholder={$t$('dict.replacement')}
            value={replacement.replacement}
            on:change={(event) => setReplacement(index, { replacement: event.currentTarget.value })}
          />
          <label class="dict-check">
            <input
              type="checkbox"
              checked={replacement.ignoreCase}
              on:change={(event) =>
                setReplacement(index, { ignoreCase: event.currentTarget.checked })}
            />
            {$t$('dict.ignoreCase')}
          </label>
          <button
            type="button"
            class="app-button app-button-quiet"
            on:click={() => removeReplacement(index)}
          >
            {$t$('dict.remove')}
          </button>
        </div>
      {/each}
      <button type="button" class="app-button dict-add" on:click={addReplacement}>
        {$t$('dict.addPattern')}
      </button>
    </SettingsItemGroup>
  </SettingsSection>

  <SettingsSection
    id="dictionary-backup"
    keywords="export import yomitan settings json reset collection"
  >
    <SettingsItemGroup title={$t$('dict.export')} tooltip={$t$('dict.exportHint')}>
      <button type="button" class="app-button" on:click={exportSettings}>
        {$t$('dict.exportButton')}
      </button>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.importSettings')} tooltip={$t$('dict.importSettingsHint')}>
      <label class="app-button dict-file">
        <input type="file" accept="application/json,.json" hidden use:inputFile={importSettings} />
        {$t$('dict.chooseFile')}
      </label>
      <svelte:fragment slot="after">
        {#if backupMessage}<p class="dict-note" role="status">{backupMessage}</p>{/if}
        {#if backupError}<p class="dict-error" role="alert">{backupError}</p>{/if}
      </svelte:fragment>
    </SettingsItemGroup>
    <DictionaryCollectionImport />
    <SettingsItemGroup title={$t$('dict.reset')} tooltip={$t$('dict.resetHint')}>
      <span class="dict-actions">
        <button
          type="button"
          class="app-button app-button-danger"
          on:click={() => confirmed('reset', resetYomitanSettings)}
        >
          {confirming === 'reset' ? $t$('dict.resetConfirm') : $t$('dict.resetButton')}
        </button>
        {#if confirming === 'reset'}
          <button
            type="button"
            class="app-button app-button-quiet"
            on:click={() => (confirming = '')}
          >
            {$t$('dict.cancel')}
          </button>
        {/if}
      </span>
    </SettingsItemGroup>
  </SettingsSection>
{/if}

<style>
  .dict-note,
  .dict-meta {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .dict-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .dict-lead {
    max-width: 48rem;
    color: var(--font-color);
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .dict-import {
    display: grid;
    justify-items: start;
    gap: 0.75rem;
    padding-bottom: 1.5rem;
  }

  .dict-file {
    cursor: pointer;
  }

  .dict-downloads {
    width: 100%;
    max-width: 48rem;
    border-top: 2px solid var(--font-color);
  }

  .dict-download {
    display: flex;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .dict-disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .dict-track {
    width: 100%;
    height: 3px;
    background: var(--app-progress-track);
  }

  .dict-fill {
    height: 100%;
    background: var(--app-progress-fill);
  }

  .dict-list {
    margin-top: 0.75rem;
    border-top: 2px solid var(--font-color);
  }

  .dict-row {
    border-bottom: 1px solid var(--border-color);
  }

  .dict-head {
    display: flex;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 0.75rem 0;
  }

  .dict-index {
    min-width: 1.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .dict-name {
    display: grid;
    flex: 1 1 auto;
    gap: 0.15rem;
    min-width: 0;
  }

  .dict-title {
    overflow-wrap: anywhere;
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
  }

  .dict-move {
    display: flex;
    gap: 0.25rem;
  }

  .dict-details summary {
    padding: 0 0 0.75rem 2.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    cursor: pointer;
  }

  .dict-details summary:hover {
    color: var(--font-color);
  }

  .dict-options {
    display: grid;
    gap: 1rem;
    padding: 0 0 1.25rem 2.5rem;
  }

  .dict-field {
    display: grid;
    gap: 0.4rem;
    max-width: 22rem;
    color: var(--font-color);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .dict-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .dict-option-text {
    display: grid;
    gap: 0.15rem;
    color: var(--font-color);
    font-size: var(--type-body);
  }

  .dict-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .dict-options .dict-actions {
    margin-top: 0;
  }

  .dict-number {
    width: 6rem;
  }

  .dict-replacement {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-top: 0.75rem;
  }

  .dict-replacement .app-input {
    flex: 1 1 10rem;
    min-width: 0;
  }

  .dict-check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--font-color);
    font-size: var(--type-small);
  }

  .dict-check input {
    accent-color: var(--accent-color);
  }

  .dict-add {
    margin-top: 0.75rem;
  }

  @media (max-width: 639px) {
    .dict-head {
      flex-wrap: wrap;
    }

    .dict-name {
      flex-basis: calc(100% - 2.5rem);
    }

    .dict-move {
      margin-left: 2.5rem;
    }

    .dict-details summary,
    .dict-options {
      padding-left: 0;
    }
  }
</style>
