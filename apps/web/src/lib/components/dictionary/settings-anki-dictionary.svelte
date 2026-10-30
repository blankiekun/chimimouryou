<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { ankiInvoke } from '$lib/data/anki';
  import {
    defaultFieldValue,
    dictionaryAnki$,
    dictionaryAnkiRoute$,
    dictionaryAnkiSettings,
    importDictionaryAnki,
    type DictionaryAnki,
    type DictionaryAnkiRoute
  } from '$lib/data/anki-dictionary';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { t$, type MessageKey } from '$lib/i18n';
  import { getStandardFieldMarkers } from '$lib/vendor/yomitan/data/anki-template-util';
  import type { AnkiDuplicateScope } from '$lib/vendor/yomitan/types/settings';

  /**
   * Settings → Anki → Dictionary cards: the card format of the built-in dictionary's Add to
   * Anki (lib/data/anki-dictionary.ts), as Yomitan's Anki settings: deck, note type, fields with
   * its {markers}, tags and the duplicate check, or imported from a Yomitan settings file.
   */

  const markers = getStandardFieldMarkers('term').map((marker) => `{${marker}}`);

  const settings = $derived(dictionaryAnkiSettings($dictionaryAnki$));
  const fields = $derived(Object.entries(settings.fields));
  const connect = $derived($dictionaryAnkiRoute$ === 'ankiconnect');
  const routes = $derived([
    { id: 'ankiconnect', text: 'AnkiConnect' },
    { id: 'ankimobile', text: 'AnkiMobile' }
  ] as ToggleOption<DictionaryAnkiRoute>[]);

  let decks = $state<string[]>([]);
  let models = $state<string[]>([]);
  let message = $state('');
  let error = $state('');
  let newField = $state('');

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

  function setField(name: string, value: string) {
    set({
      fields: { ...settings.fields, [name]: { value, overwriteMode: 'coalesce' } }
    });
  }

  function removeField(name: string) {
    const { [name]: _removed, ...rest } = settings.fields;
    set({ fields: rest });
  }

  function addField() {
    const name = newField.trim();
    if (!name || name in settings.fields) return;
    setField(name, defaultFieldValue(name, fields.length, getStandardFieldMarkers('term')));
    newField = '';
  }

  /** A note type picked: its fields from Anki, keeping values already set (as Yomitan does). */
  async function setModel(model: string) {
    set({ model });
    if (!connect || !models.includes(model)) return;
    error = '';
    try {
      const names = await ankiInvoke<string[]>('modelFieldNames', { modelName: model });
      const standard = getStandardFieldMarkers('term');
      set({
        model,
        fields: Object.fromEntries(
          names.map((name, index) => [
            name,
            {
              value: settings.fields[name]?.value ?? defaultFieldValue(name, index, standard),
              overwriteMode: 'coalesce'
            }
          ])
        )
      });
    } catch (e: any) {
      error = e.message;
    }
  }

  const duplicateOptions: { id: string; label: MessageKey }[] = [
    { id: 'off', label: 'anki.dict.duplicatesOff' },
    { id: 'collection', label: 'anki.dict.duplicatesCollection' },
    { id: 'deck', label: 'anki.dict.duplicatesDeck' },
    { id: 'deck-root', label: 'anki.dict.duplicatesDeckRoot' }
  ];

  function setDuplicates(id: string) {
    set(
      id === 'off'
        ? { checkForDuplicates: false }
        : { checkForDuplicates: true, duplicateScope: id as AnkiDuplicateScope }
    );
  }

  async function importFile(files: FileList) {
    message = '';
    error = '';
    try {
      const anki = await importDictionaryAnki(await files[0].text());
      message = $t$('anki.dict.imported', { deck: anki.deck, model: anki.model });
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
  <SettingsItemGroup title={$t$('anki.deck')}>
    <input
      aria-label={$t$('anki.deck')}
      autocomplete="off"
      class="app-input"
      list="anki-dict-decks"
      value={settings.deck}
      onchange={(event) => set({ deck: event.currentTarget.value.trim() })}
    />
    <datalist id="anki-dict-decks">
      {#each decks as deck}<option value={deck}></option>{/each}
    </datalist>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.model')}>
    <input
      aria-label={$t$('anki.dict.model')}
      autocomplete="off"
      class="app-input"
      list="anki-dict-models"
      value={settings.model}
      onchange={(event) => setModel(event.currentTarget.value.trim())}
    />
    <datalist id="anki-dict-models">
      {#each models as model}<option value={model}></option>{/each}
    </datalist>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.fields')} tooltip={$t$('anki.dict.fieldsHint')} wide>
    <datalist id="anki-dict-markers">
      {#each markers as marker}<option value={marker}></option>{/each}
    </datalist>
    <div class="anki-fields">
      {#each fields as [name, { value }] (name)}
        <label class="anki-field">
          <span class="anki-field-name">{name}</span>
          <input
            autocomplete="off"
            class="app-input"
            list="anki-dict-markers"
            {value}
            onchange={(event) => setField(name, event.currentTarget.value)}
          />
          <button
            type="button"
            class="app-button app-button-quiet"
            aria-label={$t$('anki.dict.removeField', { field: name })}
            onclick={() => removeField(name)}
          >
            {$t$('anki.dict.remove')}
          </button>
        </label>
      {/each}
      <div class="anki-field">
        <input
          aria-label={$t$('anki.dict.newField')}
          autocomplete="off"
          class="app-input"
          placeholder={$t$('anki.dict.newField')}
          bind:value={newField}
          onkeydown={(event) => event.key === 'Enter' && addField()}
        />
        <button type="button" class="app-button" disabled={!newField.trim()} onclick={addField}>
          {$t$('anki.dict.addField')}
        </button>
      </div>
    </div>
  </SettingsItemGroup>
  <SettingsItemGroup title={$t$('anki.dict.tags')}>
    <input
      aria-label={$t$('anki.dict.tags')}
      autocomplete="off"
      class="app-input"
      value={settings.tags.join(' ')}
      onchange={(event) => set({ tags: event.currentTarget.value.split(/\s+/).filter(Boolean) })}
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
</style>
