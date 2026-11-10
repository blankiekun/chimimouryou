<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import Switch from '$lib/components/switch.svelte';
  import { ankiInvoke } from '$lib/data/dictionary/anki';
  import {
    defaultFieldValue,
    dictionaryAnki$,
    dictionaryAnkiRoute$,
    dictionaryAnkiSettings,
    importDictionaryAnki,
    type DictionaryAnki,
    type DictionaryAnkiRoute
  } from '$lib/data/dictionary/anki-dictionary';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { t$, type MessageKey } from '$lib/i18n';
  import { getStandardFieldMarkers } from '$lib/vendor/yomitan/data/anki-template-util';
  import type {
    AddNoteIcon,
    AnkiCardFormat,
    AnkiCardFormatType,
    AnkiDuplicateScope,
    AnkiNoteFieldOverwriteMode
  } from '$lib/vendor/yomitan/types/settings';

  /**
   * Settings → Anki → Dictionary cards: the built-in dictionary's Add to Anki
   * (lib/data/dictionary/anki-dictionary.ts) as Yomitan's Anki settings: card formats for terms
   * and kanji (name, icon, deck, note type, fields with its {markers} and their overwrite mode),
   * tags, the duplicate check and what to do with duplicates, screenshots, suspending, syncing,
   * the note viewer and card tags and flags; or imported from a Yomitan settings file.
   */

  const markers = {
    term: getStandardFieldMarkers('term'),
    kanji: getStandardFieldMarkers('kanji')
  };

  const settings = $derived(dictionaryAnkiSettings($dictionaryAnki$));
  const connect = $derived($dictionaryAnkiRoute$ === 'ankiconnect');
  const routes = $derived([
    { id: 'ankiconnect', text: 'AnkiConnect' },
    { id: 'ankimobile', text: 'AnkiMobile' }
  ] as ToggleOption<DictionaryAnkiRoute>[]);

  let decks = $state<string[]>([]);
  let models = $state<string[]>([]);
  let message = $state('');
  let error = $state('');
  /** The new field's name, per card format */
  let newFields = $state<Record<number, string>>({});

  $effect(() => {
    if (!connect) return;
    Promise.all([ankiInvoke<string[]>('deckNames'), ankiInvoke<string[]>('modelNames')]).then(
      ([deckNames, modelNames]) => {
        decks = deckNames;
        models = modelNames;
      },
      () => {}
    );
  });

  function set(change: Partial<DictionaryAnki>) {
    dictionaryAnki$.next({ ...settings, ...change });
  }

  function setFormat(index: number, change: Partial<AnkiCardFormat>) {
    set({
      cardFormats: settings.cardFormats.map((format, i) =>
        i === index ? { ...format, ...change } : format
      )
    });
  }

  function setField(
    index: number,
    name: string,
    change: Partial<{ value: string; overwriteMode: AnkiNoteFieldOverwriteMode }>
  ) {
    const { fields } = settings.cardFormats[index];
    const field = fields[name] ?? { value: '', overwriteMode: 'coalesce' };
    setFormat(index, { fields: { ...fields, [name]: { ...field, ...change } } });
  }

  function removeField(index: number, name: string) {
    const { [name]: _removed, ...rest } = settings.cardFormats[index].fields;
    setFormat(index, { fields: rest });
  }

  function addField(index: number) {
    const format = settings.cardFormats[index];
    const name = (newFields[index] ?? '').trim();
    if (!name || name in format.fields) return;
    setField(index, name, {
      value: defaultFieldValue(
        name,
        Object.keys(format.fields).length,
        markers[format.type],
        format.type
      )
    });
    newFields = { ...newFields, [index]: '' };
  }

  /** A note type picked: its fields from Anki, keeping values already set (as Yomitan does). */
  async function setModel(index: number, model: string) {
    setFormat(index, { model });
    if (!connect || !models.includes(model)) return;
    error = '';
    try {
      // The format as it is now: by the time Anki answers, its index may be another format's.
      const format = settings.cardFormats[index];
      const names = await ankiInvoke<string[]>('modelFieldNames', { modelName: model });
      index = settings.cardFormats.indexOf(format);
      if (index < 0) return;
      setFormat(index, {
        model,
        fields: Object.fromEntries(
          names.map((name, i) => [
            name,
            format.fields[name] ?? {
              value: defaultFieldValue(name, i, markers[format.type], format.type),
              overwriteMode: 'coalesce'
            }
          ])
        )
      });
    } catch (e: any) {
      error = e.message;
    }
  }

  function addFormat() {
    set({
      cardFormats: [
        ...settings.cardFormats,
        {
          name: `Card ${settings.cardFormats.length + 1}`,
          icon: 'big-circle',
          deck: '',
          model: '',
          fields: {},
          type: 'term'
        }
      ]
    });
  }

  function removeFormat(index: number) {
    set({ cardFormats: settings.cardFormats.filter((_, i) => i !== index) });
  }

  const duplicateOptions: { id: string; label: MessageKey }[] = [
    { id: 'off', label: 'anki.dict.duplicatesOff' },
    { id: 'collection', label: 'anki.dict.duplicatesCollection' },
    { id: 'deck', label: 'anki.dict.duplicatesDeck' },
    { id: 'deck-root', label: 'anki.dict.duplicatesDeckRoot' }
  ];
  const behaviours: { id: DictionaryAnki['duplicateBehavior']; label: MessageKey }[] = [
    { id: 'prevent', label: 'anki.dict.behaviourPrevent' },
    { id: 'overwrite', label: 'anki.dict.behaviourOverwrite' },
    { id: 'new', label: 'anki.dict.behaviourNew' }
  ];
  const overwriteModes: { id: AnkiNoteFieldOverwriteMode; label: MessageKey }[] = [
    { id: 'skip', label: 'anki.dict.overwriteSkip' },
    { id: 'prepend', label: 'anki.dict.overwritePrepend' },
    { id: 'append', label: 'anki.dict.overwriteAppend' },
    { id: 'coalesce', label: 'anki.dict.overwriteCoalesce' },
    { id: 'coalesce-new', label: 'anki.dict.overwriteCoalesceNew' },
    { id: 'overwrite', label: 'anki.dict.overwriteOverwrite' }
  ];
  const icons: { id: AddNoteIcon; label: MessageKey }[] = [
    { id: 'big-circle', label: 'anki.dict.iconBigCircle' },
    { id: 'small-circle', label: 'anki.dict.iconSmallCircle' },
    { id: 'big-square', label: 'anki.dict.iconBigSquare' },
    { id: 'big-diamond', label: 'anki.dict.iconBigDiamond' }
  ];
  const types: { id: AnkiCardFormatType; label: MessageKey }[] = [
    { id: 'term', label: 'anki.dict.typeTerm' },
    { id: 'kanji', label: 'anki.dict.typeKanji' }
  ];
  const tagModes: { id: DictionaryAnki['displayTagsAndFlags']; label: MessageKey }[] = [
    { id: 'never', label: 'anki.dict.tagsNever' },
    { id: 'always', label: 'anki.dict.tagsAlways' },
    { id: 'non-standard', label: 'anki.dict.tagsNonStandard' },
    { id: 'custom', label: 'anki.dict.tagsCustom' }
  ];

  function setDuplicates(id: string) {
    set(
      id === 'off'
        ? { checkForDuplicates: false }
        : { checkForDuplicates: true, duplicateScope: id as AnkiDuplicateScope }
    );
  }

  const splitTags = (text: string) => text.split(/[,\s]+/).filter(Boolean);

  async function importFile(files: FileList) {
    message = '';
    error = '';
    try {
      const { settings: anki, server } = await importDictionaryAnki(await files[0].text());
      message =
        $t$('anki.dict.imported', {
          formats: anki.cardFormats
            .filter(({ deck, model }) => deck && model)
            .map(({ name, deck, model }) => `${name} (${deck}, ${model})`)
            .join('; ')
        }) + (server ? ` ${$t$('anki.dict.addressChanged', { address: server })}` : '');
    } catch (e: any) {
      error = $t$('anki.dict.importFailed', { error: e.message });
    }
  }
</script>

<SettingsSection id="anki-dictionary">
  <SettingsItemGroup title={$t$('anki.dict.route')}>
    <ButtonToggleGroup options={routes} bind:selectedOptionId={$dictionaryAnkiRoute$} />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.import')} tooltip={$t$('anki.dict.importHint')}>
    <label class="app-button anki-file">
      <input type="file" accept="application/json,.json" hidden use:inputFile={importFile} />
      {$t$('dict.chooseFile')}
    </label>
    {#if message}<p class="anki-note" role="status">{message}</p>{/if}
    {#if error}<p class="anki-error" role="alert">{error}</p>{/if}
  </SettingsItemGroup>
  <datalist id="anki-dict-decks">
    {#each decks as deck}<option value={deck}></option>{/each}
  </datalist>
  <datalist id="anki-dict-models">
    {#each models as model}<option value={model}></option>{/each}
  </datalist>
  {#each Object.entries(markers) as [type, list]}
    <datalist id="anki-dict-markers-{type}">
      {#each list as marker}<option value={`{${marker}}`}></option>{/each}
    </datalist>
  {/each}
  <SettingsItemGroup title={$t$('anki.dict.formats')} tooltip={$t$('anki.dict.fieldsHint')} wide>
    <div class="anki-formats">
      {#each settings.cardFormats as format, index (index)}
        <fieldset class="anki-format">
          <legend class="anki-format-title">
            <span class="anki-format-number">{String(index + 1).padStart(2, '0')}</span>
            {format.name}
          </legend>
          <div class="anki-format-row">
            <label class="anki-label">
              <span>{$t$('anki.dict.formatName')}</span>
              <input
                autocomplete="off"
                class="app-input"
                value={format.name}
                onchange={(e) => setFormat(index, { name: e.currentTarget.value.trim() })}
              />
            </label>
            <label class="anki-label">
              <span>{$t$('anki.dict.formatType')}</span>
              <select
                class="app-input"
                value={format.type}
                onchange={(e) =>
                  setFormat(index, { type: e.currentTarget.value as AnkiCardFormatType })}
              >
                {#each types as option}<option value={option.id}>{$t$(option.label)}</option>{/each}
              </select>
            </label>
            <label class="anki-label">
              <span>{$t$('anki.dict.formatIcon')}</span>
              <select
                class="app-input"
                value={format.icon}
                onchange={(e) => setFormat(index, { icon: e.currentTarget.value as AddNoteIcon })}
              >
                {#each icons as option}<option value={option.id}>{$t$(option.label)}</option>{/each}
              </select>
            </label>
          </div>
          <div class="anki-format-row">
            <label class="anki-label">
              <span>{$t$('anki.deck')}</span>
              <input
                autocomplete="off"
                class="app-input"
                list="anki-dict-decks"
                value={format.deck}
                onchange={(e) => setFormat(index, { deck: e.currentTarget.value.trim() })}
              />
            </label>
            <label class="anki-label">
              <span>{$t$('anki.dict.model')}</span>
              <input
                autocomplete="off"
                class="app-input"
                list="anki-dict-models"
                value={format.model}
                onchange={(e) => setModel(index, e.currentTarget.value.trim())}
              />
            </label>
          </div>
          <div class="anki-fields" role="group" aria-label={$t$('anki.dict.fields')}>
            {#each Object.entries(format.fields) as [name, field] (name)}
              <div class="anki-field">
                <span class="anki-field-name">{name}</span>
                <input
                  autocomplete="off"
                  class="app-input"
                  aria-label={name}
                  list="anki-dict-markers-{format.type}"
                  value={field.value}
                  onchange={(e) => setField(index, name, { value: e.currentTarget.value })}
                />
                {#if settings.duplicateBehavior === 'overwrite'}
                  <select
                    class="app-input anki-overwrite"
                    aria-label={$t$('anki.dict.overwriteMode', { field: name })}
                    value={field.overwriteMode}
                    onchange={(e) =>
                      setField(index, name, {
                        overwriteMode: e.currentTarget.value as AnkiNoteFieldOverwriteMode
                      })}
                  >
                    {#each overwriteModes as option}
                      <option value={option.id}>{$t$(option.label)}</option>
                    {/each}
                  </select>
                {/if}
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  aria-label={$t$('anki.dict.removeField', { field: name })}
                  onclick={() => removeField(index, name)}
                >
                  {$t$('anki.dict.remove')}
                </button>
              </div>
            {/each}
            <div class="anki-field">
              <input
                aria-label={$t$('anki.dict.newField')}
                autocomplete="off"
                class="app-input"
                placeholder={$t$('anki.dict.newField')}
                value={newFields[index] ?? ''}
                oninput={(e) => (newFields = { ...newFields, [index]: e.currentTarget.value })}
                onkeydown={(e) => e.key === 'Enter' && addField(index)}
              />
              <button
                type="button"
                class="app-button"
                disabled={!(newFields[index] ?? '').trim()}
                onclick={() => addField(index)}
              >
                {$t$('anki.dict.addField')}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="app-button app-button-quiet anki-format-remove"
            onclick={() => removeFormat(index)}
          >
            {$t$('anki.dict.removeFormat', { format: format.name })}
          </button>
        </fieldset>
      {/each}
      <button type="button" class="app-button anki-format-add" onclick={addFormat}>
        {$t$('anki.dict.addFormat')}
      </button>
    </div>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.tags')}>
    <input
      aria-label={$t$('anki.dict.tags')}
      autocomplete="off"
      class="app-input"
      value={settings.tags.join(' ')}
      onchange={(event) => set({ tags: splitTags(event.currentTarget.value) })}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.duplicates')}>
    <select
      class="app-input"
      aria-label={$t$('anki.dict.duplicates')}
      value={settings.checkForDuplicates ? settings.duplicateScope : 'off'}
      onchange={(event) => setDuplicates(event.currentTarget.value)}
    >
      {#each duplicateOptions as option}
        <option value={option.id}>{$t$(option.label)}</option>
      {/each}
    </select>
  </SettingsItemGroup>
  {#if settings.checkForDuplicates}
    <SettingsItemGroup title={$t$('anki.dict.allModels')} tooltip={$t$('anki.dict.allModelsHint')}>
      <Switch
        aria-label={$t$('anki.dict.allModels')}
        checked={settings.duplicateScopeCheckAllModels}
        onchange={(next) => set({ duplicateScopeCheckAllModels: next })}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('anki.dict.behaviour')} tooltip={$t$('anki.dict.behaviourHint')}>
      <select
        class="app-input"
        aria-label={$t$('anki.dict.behaviour')}
        value={settings.duplicateBehavior}
        onchange={(e) =>
          set({ duplicateBehavior: e.currentTarget.value as DictionaryAnki['duplicateBehavior'] })}
      >
        {#each behaviours as option}<option value={option.id}>{$t$(option.label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t$('anki.dict.dupeCheckFirst')}
      tooltip={$t$('anki.dict.dupeCheckFirstHint')}
    >
      <Switch
        aria-label={$t$('anki.dict.dupeCheckFirst')}
        checked={settings.noteDupeCheckFirst}
        onchange={(next) => set({ noteDupeCheckFirst: next })}
      />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('anki.dict.screenshot')} tooltip={$t$('anki.dict.screenshotHint')}>
    <span class="anki-inline">
      <select
        class="app-input"
        aria-label={$t$('anki.dict.screenshotFormat')}
        value={settings.screenshot.format}
        onchange={(e) =>
          set({
            screenshot: {
              ...settings.screenshot,
              format: e.currentTarget.value as DictionaryAnki['screenshot']['format']
            }
          })}
      >
        <option value="png">PNG</option>
        <option value="jpeg">JPEG</option>
      </select>
      {#if settings.screenshot.format === 'jpeg'}
        <label class="anki-inline">
          <span>{$t$('anki.dict.screenshotQuality')}</span>
          <input
            class="app-input anki-number"
            type="number"
            min="0"
            max="100"
            step="1"
            value={settings.screenshot.quality}
            onchange={(e) =>
              set({
                screenshot: {
                  ...settings.screenshot,
                  quality: Math.max(
                    0,
                    Math.min(100, Math.round(e.currentTarget.valueAsNumber || 0))
                  )
                }
              })}
          />
        </label>
      {/if}
    </span>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.suspend')} tooltip={$t$('anki.dict.suspendHint')}>
    <Switch
      aria-label={$t$('anki.dict.suspend')}
      checked={settings.suspendNewCards}
      onchange={(next) => set({ suspendNewCards: next })}
    />
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.viewer')} tooltip={$t$('anki.dict.viewerHint')}>
    <select
      class="app-input"
      aria-label={$t$('anki.dict.viewer')}
      value={settings.noteGuiMode}
      onchange={(e) => set({ noteGuiMode: e.currentTarget.value as DictionaryAnki['noteGuiMode'] })}
    >
      <option value="browse">{$t$('anki.dict.viewerBrowse')}</option>
      <option value="edit">{$t$('anki.dict.viewerEdit')}</option>
    </select>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.tagsFlags')} tooltip={$t$('anki.dict.tagsFlagsHint')}>
    <select
      class="app-input"
      aria-label={$t$('anki.dict.tagsFlags')}
      value={settings.displayTagsAndFlags}
      onchange={(e) =>
        set({
          displayTagsAndFlags: e.currentTarget.value as DictionaryAnki['displayTagsAndFlags']
        })}
    >
      {#each tagModes as option}<option value={option.id}>{$t$(option.label)}</option>{/each}
    </select>
  </SettingsItemGroup>
  {#if settings.displayTagsAndFlags === 'custom'}
    <SettingsItemGroup
      title={$t$('anki.dict.targetTags')}
      tooltip={$t$('anki.dict.targetTagsHint')}
    >
      <input
        aria-label={$t$('anki.dict.targetTags')}
        autocomplete="off"
        class="app-input"
        value={settings.targetTags.join(' ')}
        onchange={(e) => set({ targetTags: splitTags(e.currentTarget.value) })}
      />
    </SettingsItemGroup>
  {/if}
  <SettingsItemGroup title={$t$('anki.dict.forceSync')} tooltip={$t$('anki.dict.forceSyncHint')}>
    <Switch
      aria-label={$t$('anki.dict.forceSync')}
      checked={settings.forceSync}
      onchange={(next) => set({ forceSync: next })}
    />
  </SettingsItemGroup>
  {#if settings.fieldTemplates !== null}
    <SettingsItemGroup title={$t$('anki.dict.templates')}>
      <button type="button" class="app-button" onclick={() => set({ fieldTemplates: null })}>
        {$t$('anki.dict.templatesReset')}
      </button>
    </SettingsItemGroup>
  {/if}
</SettingsSection>

<style>
  .anki-file {
    cursor: pointer;
  }

  .anki-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .anki-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .anki-formats {
    display: grid;
    gap: 1rem;
  }

  .anki-format {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    margin: 0;
    padding: 0.75rem 0 0;
    border: 0;
    border-top: 2px solid var(--font-color);
  }

  .anki-format-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0;
    font-size: var(--type-body);
    font-weight: 700;
  }

  .anki-format-number {
    padding: 0 0.35rem;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }

  .anki-format-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }

  .anki-label {
    display: grid;
    flex: 1 1 10rem;
    gap: 0.25rem;
    min-width: 0;
    font-size: var(--type-label);
    color: var(--app-muted-fg);
  }

  .anki-fields {
    display: grid;
    gap: 0.5rem;
  }

  .anki-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .anki-field-name {
    min-width: 8rem;
    font-size: var(--type-small);
    overflow-wrap: anywhere;
  }

  .anki-field input {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .anki-overwrite {
    width: auto;
  }

  .anki-format-remove {
    justify-self: start;
  }

  .anki-format-add {
    justify-self: start;
  }

  .anki-inline {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--type-small);
  }

  .anki-number {
    width: 5rem;
  }
</style>
