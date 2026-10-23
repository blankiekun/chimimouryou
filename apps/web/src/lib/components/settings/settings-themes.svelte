<script lang="ts">
  import SettingsThemeColor from '$lib/components/settings/settings-theme-color.svelte';
  import { theme$ } from '$lib/data/store';
  import {
    customAppThemes$,
    darkTheme$,
    followSystemTheme$,
    previewTheme$,
    selectedThemeId$,
    selectTheme,
    themeDefinitions$
  } from '$lib/data/theme/theme-store';
  import { parseCssColor } from '$lib/data/theme/color-utils';
  import { contrastIssues, minimumContrast } from '$lib/data/theme/contrast';
  import { themeTokens, themeTokensByGroup, type ThemeToken } from '$lib/data/theme/theme-tokens';
  import {
    builtInThemeIds,
    defaultDarkThemeId,
    defaultLightThemeId,
    exportableTheme,
    parseThemeDefinition,
    resolveTheme,
    uniqueThemeId,
    type ResolvedTheme,
    type ThemeDefinition
  } from '$lib/data/theme/themes';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { onDestroy, tick } from 'svelte';
  import { t$, type MessageKey } from '$lib/i18n';

  /** Number of themes in the gallery, for the section head */
  export let count = 0;

  let editing: ThemeDefinition | undefined;
  /** Id the edited theme had when editing started (renames change the id) */
  let editingOriginalId = '';
  let importText = '';
  let importError = '';
  let showImport = false;
  let message = '';

  $: themes = ($themeDefinitions$ ?? []).map((definition) => ({
    definition,
    resolved: resolveTheme(definition.id, $customAppThemes$)
  }));
  $: count = themes.length;
  $: baseOptions = [
    { id: 'light', name: $t$('prefs.themes.lightBase') },
    { id: 'dark', name: $t$('prefs.themes.darkBase') },
    ...themes
      .filter(({ definition }) => definition.id !== editing?.id)
      .map(({ resolved }) => ({ id: resolved.id, name: resolved.name }))
  ];
  $: parent = editing
    ? resolveTheme(editing.extends || (editing.dark ? 'dark' : 'light'), $customAppThemes$)
    : undefined;
  $: previewTheme$.next(editing ? { ...editing } : undefined);
  // Contrast of the theme being edited; a hint only, saving is never blocked.
  $: editedColors = editing
    ? resolveTheme(editing.id, { ...$customAppThemes$, [editing.id]: editing }).colors
    : undefined;
  $: lowContrast = editedColors ? contrastIssues(editedColors, parseCssColor) : [];
  const tokenLabel = (token: ThemeToken) =>
    themeTokens.find((entry) => entry.token === token)?.label ?? token;
  let previewOn = true;

  onDestroy(() => previewTheme$.next(undefined));

  function flash(text: string) {
    message = text;
    setTimeout(() => {
      if (message === text) {
        message = '';
      }
    }, 2500);
  }

  /** The tag under a theme in use: one slot, or both while following the system. */
  function themeStatus(
    id: string,
    follow: boolean,
    light: string,
    dark: string
  ): MessageKey | undefined {
    if (!follow) return id === light ? 'prefs.themes.inUse' : undefined;
    if (id === light) return 'prefs.themes.lightInUse';
    if (id === dark) return 'prefs.themes.darkInUse';
    return undefined;
  }

  async function showEditor() {
    await tick();
    document.getElementById('theme-editor-title')?.scrollIntoView({ behavior: 'smooth' });
  }

  function startNew(from?: ResolvedTheme) {
    const base = from ?? resolveTheme($selectedThemeId$ ?? $theme$, $customAppThemes$);
    const name = from ? `${from.name} (copy)` : 'My theme';

    editing = {
      id: uniqueThemeId(name, $customAppThemes$),
      name,
      extends: base.id,
      colors: {}
    };
    editingOriginalId = '';
    showEditor();
  }

  function startEdit(definition: ThemeDefinition) {
    editing = JSON.parse(JSON.stringify(definition));
    editingOriginalId = definition.id;
    showEditor();
  }

  function setColor(token: ThemeToken, value: string | undefined) {
    if (!editing) {
      return;
    }

    const colors = { ...(editing.colors || {}) };

    if (value === undefined) {
      delete colors[token];
    } else {
      colors[token] = value;
    }

    editing = { ...editing, colors };
  }

  function save() {
    if (!editing) {
      return;
    }

    const name = editing.name.trim() || 'Untitled theme';
    const custom = { ...$customAppThemes$ };

    if (editingOriginalId) {
      delete custom[editingOriginalId];
    }

    const id =
      editingOriginalId && editingOriginalId === editing.id
        ? editing.id
        : uniqueThemeId(name, custom);

    custom[id] = { ...editing, id, name };
    customAppThemes$.next(custom);
    // A rename changes the id; keep it selected in whichever slot used it.
    if (editingOriginalId && editingOriginalId !== id) {
      if ($theme$ === editingOriginalId) {
        theme$.next(id);
      }

      if ($darkTheme$ === editingOriginalId) {
        darkTheme$.next(id);
      }
    }
    // Select new themes; an edited one stays in the slot(s) it is in.
    if (![theme$.getValue(), darkTheme$.getValue()].includes(id)) {
      selectTheme(id);
    }
    editing = undefined;
    flash($t$('prefs.themes.saved', { name }));
  }

  function remove(definition: ThemeDefinition) {
    if (!window.confirm($t$('prefs.themes.deleteConfirm', { name: definition.name }))) {
      return;
    }

    const custom = { ...$customAppThemes$ };

    delete custom[definition.id];
    customAppThemes$.next(custom);

    const fallback = (base: string) =>
      definition.extends && !['light', 'dark'].includes(definition.extends)
        ? definition.extends
        : base;

    if ($theme$ === definition.id) {
      theme$.next(fallback(defaultLightThemeId));
    }

    if ($darkTheme$ === definition.id) {
      darkTheme$.next(fallback(defaultDarkThemeId));
    }
  }

  function download(definition: ThemeDefinition) {
    downloadBlob(
      new Blob([exportableTheme(definition)], { type: 'application/json' }),
      `${definition.id}.json`
    );
  }

  async function copy(definition: ThemeDefinition) {
    await navigator.clipboard.writeText(exportableTheme(definition));
    flash($t$('prefs.themes.copied'));
  }

  function importTheme(json: string) {
    try {
      const parsed = parseThemeDefinition(JSON.parse(json));
      const id = uniqueThemeId(parsed.id || parsed.name, $customAppThemes$);

      customAppThemes$.next({ ...$customAppThemes$, [id]: { ...parsed, id } });
      selectTheme(id);
      importError = '';
      importText = '';
      showImport = false;
      flash($t$('prefs.themes.imported', { name: parsed.name }));
    } catch (e: any) {
      importError =
        e instanceof SyntaxError
          ? $t$('prefs.themes.invalidJson', { message: e.message })
          : e.message;
    }
  }

  async function importFiles(files: FileList | File[]) {
    const file = Array.from(files)[0];

    if (file) {
      importTheme(await file.text());
    }
  }
</script>

<div class="theme-toolbar">
  <button type="button" class="app-button" on:click={() => startNew()}>
    {$t$('prefs.themes.new')}
  </button>
  <button
    type="button"
    class="app-button app-button-quiet"
    aria-expanded={showImport}
    on:click={() => (showImport = !showImport)}
  >
    {$t$('prefs.themes.import')}
  </button>
  <a
    class="app-button app-button-quiet"
    href="/themes.md"
    rel="external"
    target="_blank"
    title={$t$('prefs.themes.guideTitle')}
  >
    {$t$('prefs.themes.guide')}
  </a>
  <span class="theme-message" role="status">{message}</span>
</div>

{#if showImport}
  <div class="theme-import">
    <label for="theme-import-text">{$t$('prefs.themes.importHint')}</label>
    <textarea
      id="theme-import-text"
      class="app-input theme-code"
      rows="8"
      spellcheck="false"
      placeholder={'{\n  "name": "My theme",\n  "extends": "dark-theme",\n  "colors": { "accent": "#e879f9" }\n}'}
      bind:value={importText}
    />
    {#if importError}
      <p class="theme-error">{importError}</p>
    {/if}
    <div class="theme-import-actions">
      <button
        type="button"
        class="app-button"
        disabled={!importText.trim()}
        on:click={() => importTheme(importText)}
      >
        {$t$('prefs.themes.importJson')}
      </button>
      <label class="app-button app-button-quiet cursor-pointer">
        <input type="file" accept="application/json,.json" hidden use:inputFile={importFiles} />
        {$t$('prefs.themes.chooseFile')}
      </label>
    </div>
  </div>
{/if}

<ul class="theme-gallery">
  {#each themes as { definition, resolved } (definition.id)}
    {@const colors = resolved.colors}
    {@const custom = !builtInThemeIds.has(definition.id)}
    {@const status = themeStatus(definition.id, $followSystemTheme$, $theme$, $darkTheme$)}
    <li class="theme-card">
      <button
        type="button"
        class="theme-preview"
        class:theme-preview-active={!!status}
        style:background={colors.background}
        aria-pressed={$selectedThemeId$ === definition.id}
        title={$t$('prefs.themes.use', { name: resolved.name })}
        on:click={() => selectTheme(definition.id)}
      >
        <span class="theme-preview-header" style:background={colors.headerBackground}>
          <span style:background={colors.headerIcon} />
          <span style:background={colors.headerIcon} />
        </span>
        <span class="theme-preview-body">
          <span
            class="theme-preview-card"
            style:background={colors.surfaceStrong}
            style:border-color={colors.border}
          >
            <span style:background={colors.text} />
            <span style:background={colors.mutedText} />
            <span class="theme-preview-accent" style:background={colors.accent} />
          </span>
          <span class="theme-preview-page" style:color={colors.readerText}>あ亜ア</span>
        </span>
      </button>
      <p class="theme-card-name">
        <span class:theme-card-name-active={!!status}>{resolved.name}</span>
        {#if status}
          <span class="app-tag">{$t$(status)}</span>
        {:else if custom}
          <span class="app-tag app-tag-muted">{$t$('prefs.themes.custom')}</span>
        {/if}
      </p>
      <p class="theme-card-actions">
        {#if custom}
          <button type="button" on:click={() => startEdit(definition)}>{$t$('prefs.edit')}</button>
        {/if}
        <button
          type="button"
          title={$t$('prefs.themes.duplicate')}
          on:click={() => startNew(resolved)}>{$t$('prefs.themes.duplicateShort')}</button
        >
        <button
          type="button"
          title={$t$('prefs.themes.downloadJson')}
          on:click={() => download(definition)}>JSON</button
        >
        {#if custom}
          <button type="button" on:click={() => remove(definition)}>{$t$('prefs.delete')}</button>
        {/if}
      </p>
    </li>
  {/each}
</ul>

{#if editing && parent}
  <section class="theme-editor" aria-labelledby="theme-editor-title">
    <header class="theme-editor-head">
      <div class="min-w-0">
        <h3 id="theme-editor-title">
          {$t$('prefs.themes.editingName', { name: editing.name || '…' })}
        </h3>
        <p>{$t$('prefs.themes.editing')}</p>
      </div>
      <div class="theme-editor-actions">
        <button
          type="button"
          class="app-button app-button-quiet"
          on:click={() => copy(editing ?? { id: '', name: '' })}
        >
          {$t$('prefs.themes.copyJson')}
        </button>
        <button
          type="button"
          class="app-button app-button-quiet"
          on:click={() => (editing = undefined)}
        >
          {$t$('prefs.cancel')}
        </button>
        <button type="button" class="app-button app-button-primary" on:click={save}>
          {$t$('prefs.save')}
        </button>
      </div>
    </header>

    <div class="theme-editor-columns">
      <div class="theme-editor-form">
        <h4 class="theme-editor-label">{$t$('prefs.themes.general')}</h4>
        <div class="theme-fields">
          <label class="theme-field">
            <span>{$t$('prefs.themes.name')}</span>
            <input class="app-input" type="text" bind:value={editing.name} />
          </label>
          <label class="theme-field">
            <span>{$t$('prefs.themes.basedOn')}</span>
            <select class="app-input" bind:value={editing.extends}>
              {#each baseOptions as option (option.id)}
                <option value={option.id}>{option.name}</option>
              {/each}
            </select>
          </label>
          <label class="theme-field">
            <span>{$t$('prefs.themes.dark')}</span>
            <select
              class="app-input"
              value={editing.dark === undefined ? 'inherit' : String(editing.dark)}
              on:change={(event) => {
                const { value } = event.currentTarget;
                if (editing) {
                  editing = {
                    ...editing,
                    dark: value === 'inherit' ? undefined : value === 'true'
                  };
                }
              }}
            >
              <option value="inherit"
                >{$t$(
                  parent.dark ? 'prefs.themes.sameAsBaseDark' : 'prefs.themes.sameAsBaseLight'
                )}</option
              >
              <option value="true">{$t$('prefs.themes.darkGroup')}</option>
              <option value="false">{$t$('prefs.themes.lightGroup')}</option>
            </select>
          </label>
          <label class="theme-field">
            <span>{$t$('prefs.themes.uiFont')}</span>
            <input
              class="app-input"
              type="text"
              placeholder="BIZ UDPGothic"
              value={editing.uiFont ?? ''}
              on:change={(event) =>
                editing &&
                (editing = { ...editing, uiFont: event.currentTarget.value.trim() || undefined })}
            />
          </label>
          <label class="theme-field">
            <span
              >{$t$('prefs.themes.roundness', {
                value: (editing.radius ?? parent.radius).toFixed(2)
              })}</span
            >
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={editing.radius ?? parent.radius}
              on:input={(event) =>
                editing && (editing = { ...editing, radius: Number(event.currentTarget.value) })}
            />
          </label>
          <label class="theme-field">
            <span>{$t$('prefs.themes.blur', { value: editing.blur ?? parent.blur })}</span>
            <input
              type="range"
              min="0"
              max="48"
              step="1"
              value={editing.blur ?? parent.blur}
              on:input={(event) =>
                editing && (editing = { ...editing, blur: Number(event.currentTarget.value) })}
            />
          </label>
        </div>

        {#if lowContrast.length}
          <div class="theme-contrast-warning" role="status">
            <strong>{$t$('prefs.themes.lowContrast')}</strong>
            {$t$('prefs.themes.lowContrastText', { ratio: minimumContrast })}
            <ul>
              {#each lowContrast as issue (issue.foreground + issue.background)}
                <li>
                  {$t$('prefs.themes.contrastIssue', {
                    foreground: tokenLabel(issue.foreground),
                    background: tokenLabel(issue.background),
                    ratio: issue.ratio.toFixed(1)
                  })}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="theme-groups">
          {#each themeTokensByGroup as { group, tokens }, index (group)}
            <details class="theme-group" open={index === 0}>
              <summary>
                {group}
                <span>{$t$('prefs.themes.colours', { count: tokens.length })}</span>
              </summary>
              {#each tokens as info (info.token)}
                <SettingsThemeColor
                  label={info.label}
                  description={info.description}
                  cssVar={info.cssVar}
                  value={editing.colors?.[info.token]}
                  inherited={parent.colors[info.token]}
                  on:change={({ detail }) => setColor(info.token, detail)}
                />
              {/each}
            </details>
          {/each}
        </div>

        <label class="theme-css">
          <span class="theme-editor-label">{$t$('prefs.themes.customCss')}</span>
          <span class="theme-css-hint">{$t$('prefs.themes.customCssHint')}</span>
          <textarea
            class="app-input theme-code"
            rows="5"
            spellcheck="false"
            placeholder="e.g. .app-header &#123; letter-spacing: 0.02em; &#125;"
            value={editing.customCss ?? ''}
            on:input={(event) =>
              editing &&
              (editing = { ...editing, customCss: event.currentTarget.value || undefined })}
          />
        </label>
      </div>

      <aside class="theme-live-preview" aria-label={$t$('prefs.themes.preview')}>
        <p class="theme-editor-label">{$t$('prefs.themes.preview')}</p>
        <div class="theme-live-row">
          <span>
            <span class="block">{$t$('prefs.themes.previewRow')}</span>
            <span class="theme-live-muted">{$t$('prefs.themes.previewDescription')}</span>
          </span>
          <button
            type="button"
            role="switch"
            class="app-switch"
            aria-checked={previewOn}
            aria-label={$t$('prefs.themes.previewSwitch')}
            on:click={() => (previewOn = !previewOn)}
          >
            <span class="app-switch-thumb" />
          </button>
        </div>
        <div class="theme-live-buttons">
          <button type="button" class="app-button app-button-primary"
            >{$t$('prefs.themes.primary')}</button
          >
          <button type="button" class="app-button">{$t$('prefs.themes.secondary')}</button>
        </div>
        <div class="theme-live-page" lang="ja">
          <p class="theme-live-title">吾輩は猫である</p>
          <p class="theme-live-muted">夏目漱石</p>
          <p class="theme-live-text">
            吾輩は<ruby>猫<rt>ねこ</rt></ruby>である。名前はまだ無い。<mark
              style:background="var(--highlight-yellow)"
              style:color="inherit">どこで生れたか</mark
            >とんと見当がつかぬ。
          </p>
        </div>
      </aside>
    </div>
  </section>
{/if}

<style>
  .theme-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    padding-top: 1rem;
  }

  .theme-message {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .theme-import {
    display: grid;
    gap: 0.5rem;
    margin-top: 1rem;
    font-size: var(--type-small);
  }

  .theme-import-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.25rem;
  }

  .theme-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .theme-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 1.5rem 1.25rem;
    margin-top: 1rem;
  }

  .theme-card {
    min-width: 0;
  }

  .theme-preview {
    display: flex;
    width: 100%;
    aspect-ratio: 214 / 123;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    text-align: left;
  }

  .theme-preview-active {
    border: 2px solid var(--accent-color);
  }

  .theme-preview-header {
    display: flex;
    height: 1.25rem;
    flex-shrink: 0;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.6rem;
  }

  .theme-preview-header span {
    width: 0.9rem;
    height: 0.2rem;
  }

  .theme-preview-body {
    display: grid;
    flex: 1;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem;
  }

  .theme-preview-card {
    display: flex;
    height: 100%;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem 0.5rem;
    border: 1px solid;
    border-radius: 1px;
  }

  .theme-preview-card span {
    width: 70%;
    height: 0.2rem;
  }

  .theme-preview-card span:nth-child(2) {
    width: 50%;
  }

  .theme-preview-accent {
    width: 30% !important;
  }

  .theme-preview-page {
    font-size: var(--type-body);
    text-align: center;
  }

  .theme-card-name {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    margin-top: 0.5rem;
    font-size: var(--type-small);
  }

  .theme-card-name-active {
    color: var(--accent-strong-color);
  }

  .theme-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin-top: 0.25rem;
  }

  .theme-card-actions button {
    min-height: 1.75rem;
    color: var(--accent-strong-color);
    font-size: var(--type-label);
  }

  .theme-card-actions button:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .theme-editor {
    margin-top: 2rem;
    padding: 1.25rem 1.5rem 1.5rem;
    border: 2px solid var(--accent-color);
    border-radius: 2px;
  }

  .theme-editor-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
  }

  .theme-editor-head h3 {
    font-size: var(--type-h2);
    font-weight: 400;
  }

  .theme-editor-head p {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .theme-editor-actions {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .theme-editor-columns {
    display: grid;
    gap: 1.5rem;
    margin-top: 1.25rem;
  }

  @media (min-width: 1024px) {
    .theme-editor-columns {
      grid-template-columns: minmax(0, 1fr) 18rem;
      align-items: start;
    }
  }

  .theme-editor-label {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .theme-fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.75rem 1rem;
    margin-top: 0.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--font-color);
  }

  .theme-field {
    display: grid;
    gap: 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .theme-field .app-input {
    width: 100%;
    min-width: 0;
  }

  .theme-field input[type='range'] {
    min-height: var(--app-control-height);
    accent-color: var(--accent-color);
  }

  .theme-groups {
    display: grid;
  }

  .theme-group {
    border-bottom: 1px solid var(--border-color);
  }

  .theme-group summary {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
  }

  .theme-group summary span {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .theme-group[open] summary {
    border-bottom: 1px solid var(--border-color);
  }

  .theme-css {
    display: grid;
    gap: 0.3rem;
    margin-top: 1.25rem;
  }

  .theme-css-hint {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .theme-code {
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: var(--type-label);
  }

  .theme-contrast-warning {
    margin-top: 1rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--app-warning-color);
    border-radius: 2px;
    font-size: var(--type-small);
  }

  .theme-contrast-warning ul {
    margin-top: 0.25rem;
    padding-left: 1.1rem;
    list-style: disc;
  }

  .theme-live-preview {
    position: sticky;
    top: 5rem;
    display: grid;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--surface-strong-color);
  }

  .theme-live-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .theme-live-muted {
    display: block;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .theme-live-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .theme-live-page {
    padding: 0.75rem;
    background: var(--reader-background-color);
    color: var(--reader-text-color);
  }

  .theme-live-title {
    font-weight: 700;
  }

  .theme-live-text {
    margin-top: 0.5rem;
    font-size: var(--type-small);
    line-height: 1.9;
  }

  @media (max-width: 1023px) {
    .theme-live-preview {
      position: static;
    }
  }
</style>
