<script lang="ts">
  /**
   * Settings → Dictionary lookups: Popup, Scanning, Audio and Shortcuts for the built-in lookup
   * popup (components/dictionary/lookup-popup.svelte), in Yomitan's options shape, with
   * Yomitan's scanning inputs table (ScanInputsController, KeyboardMouseInputField for the
   * inputs); the Anki shortcuts (addNote, viewNotes) take a card format from Settings → Anki →
   * Dictionary cards. Left out: the search page's and the extension's own options. Not part of
   * upstream.
   */
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import Switch from '$lib/components/switch.svelte';
  import {
    profileOptions,
    updateProfileOptions,
    yomitanOptions$
  } from '$lib/data/dictionary/dictionary';
  import { audioSourceTypes, playTermAudio } from '$lib/data/dictionary/dictionary-audio';
  import { dictionaryAnki$, dictionaryAnkiSettings } from '$lib/data/dictionary/anki-dictionary';
  import {
    eventModifiers,
    hotkeyLabel,
    hotkeyScope,
    isSupportedHotkey,
    pageHotkeyActions,
    popupHotkeyActions,
    type HotkeyAction
  } from '$lib/functions/dictionary/hotkeys';
  import { getActiveModifiers } from '$lib/vendor/yomitan/dom/document-util';
  import { t$ } from '$lib/i18n';
  import type {
    AudioSourceOptions,
    ProfileOptions,
    ScanningInput
  } from '$lib/vendor/yomitan/types/settings';

  $: profile = $yomitanOptions$ ? profileOptions($yomitanOptions$) : undefined;
  $: general = profile?.general;
  $: scanning = profile?.scanning;

  let voices: SpeechSynthesisVoice[] = [];
  let listening = -1;

  onMount(() => {
    const synthesis = globalThis.speechSynthesis;
    if (!synthesis) return;
    const load = () => (voices = synthesis.getVoices().filter(({ lang }) => lang.startsWith('ja')));
    load();
    synthesis.addEventListener('voiceschanged', load);
    return () => synthesis.removeEventListener('voiceschanged', load);
  });

  const set = (change: (options: ProfileOptions) => void) => updateProfileOptions(change);

  function number(value: string, min: number, max = Number.MAX_SAFE_INTEGER, step = 1) {
    const parsed = Math.round((Number(value) || 0) / step) * step;
    return Math.max(min, Math.min(max, parsed));
  }

  const selects = {
    displayMode: [
      ['default', 'dict.popupNear'],
      ['full-width', 'dict.popupFullWidth']
    ],
    fullWidthPosition: [
      ['bottom', 'dict.bottom'],
      ['top', 'dict.top']
    ],
    horizontal: [
      ['below', 'dict.below'],
      ['above', 'dict.above']
    ],
    vertical: [
      ['default', 'dict.verticalDefault'],
      ['before', 'dict.verticalBefore'],
      ['after', 'dict.verticalAfter'],
      ['left', 'dict.left'],
      ['right', 'dict.right']
    ],
    termDisplay: [
      ['ruby', 'dict.termRuby'],
      ['ruby-and-reading', 'dict.termRubyReading'],
      ['term-and-reading', 'dict.termReading'],
      ['term-only', 'dict.termOnly']
    ],
    glossary: [
      ['default', 'dict.glossaryDefault'],
      ['compact', 'dict.glossaryCompact']
    ],
    frequency: [
      ['split-tags-grouped', 'dict.frequencyTags'],
      ['list', 'dict.frequencyList']
    ],
    indicator: [
      ['none', 'dict.indicatorNone'],
      ['asterisk', 'dict.indicatorAsterisk'],
      ['triangle', 'dict.indicatorTriangle'],
      ['bar-left', 'dict.indicatorBarLeft'],
      ['bar-right', 'dict.indicatorBarRight'],
      ['dot-left', 'dict.indicatorDotLeft'],
      ['dot-right', 'dict.indicatorDotRight']
    ],
    actionBarVisibility: [
      ['auto', 'dict.actionBarAuto'],
      ['always', 'dict.actionBarAlways']
    ],
    actionBarLocation: [
      ['top', 'dict.top'],
      ['bottom', 'dict.bottom'],
      ['left', 'dict.left'],
      ['right', 'dict.right']
    ],
    scanResolution: [
      ['character', 'dict.scanResolutionCharacter'],
      ['word', 'dict.scanResolutionWord']
    ],
    fallbackSound: [
      ['none', 'dict.none'],
      ['click', 'dict.fallbackClick'],
      ['bloop', 'dict.fallbackBloop']
    ]
  } as const;

  const reducedMotionScales = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

  const inputTypes = [
    ['mouse', 'dict.inputMouse'],
    ['touch', 'dict.inputTouch'],
    ['pen', 'dict.inputPen']
  ] as const;

  const inputOptionGroups = [
    [
      'dict.inputSearchTypes',
      [
        ['searchTerms', 'dict.inputSearchTerms'],
        ['searchKanji', 'dict.inputSearchKanji']
      ]
    ],
    [
      'dict.inputTouchOptions',
      [
        ['scanOnTouchTap', 'dict.scanOnTouchTap'],
        ['scanOnTouchPress', 'dict.scanOnTouchPress'],
        ['scanOnTouchRelease', 'dict.scanOnTouchRelease'],
        ['scanOnTouchMove', 'dict.scanOnTouchMove'],
        ['preventTouchScrolling', 'dict.preventTouchScrolling']
      ]
    ],
    [
      'dict.inputPenOptions',
      [
        ['scanOnPenPress', 'dict.scanOnPenPress'],
        ['scanOnPenRelease', 'dict.scanOnPenRelease'],
        ['scanOnPenMove', 'dict.scanOnPenMove'],
        ['scanOnPenHover', 'dict.scanOnPenHover'],
        ['scanOnPenReleaseHover', 'dict.scanOnPenReleaseHover'],
        ['preventPenScrolling', 'dict.preventPenScrolling']
      ]
    ]
  ] as const;

  const preventToggles = [
    ['preventMiddleMouse', 'onWebPages', 'dict.preventMiddleWeb'],
    ['preventMiddleMouse', 'onPopupPages', 'dict.preventMiddlePopup'],
    ['preventBackForward', 'onWebPages', 'dict.preventBackForwardWeb'],
    ['preventBackForward', 'onPopupPages', 'dict.preventBackForwardPopup']
  ] as const;

  const hotkeyActions = [...popupHotkeyActions, ...pageHotkeyActions];
  let newHotkeyAction: HotkeyAction = 'scanSelectedText';

  const pitchToggles = [
    ['showPitchAccentDownstepNotation', 'dict.pitchDownstep'],
    ['showPitchAccentPositionNotation', 'dict.pitchPosition'],
    ['showPitchAccentGraph', 'dict.pitchGraph']
  ] as const;

  function setGeneral<K extends keyof ProfileOptions['general']>(
    key: K,
    value: ProfileOptions['general'][K]
  ) {
    set((p) => (p.general[key] = value));
  }

  function setScanning<K extends keyof ProfileOptions['scanning']>(
    key: K,
    value: ProfileOptions['scanning'][K]
  ) {
    set((p) => (p.scanning[key] = value));
  }

  /** A select's value for a string-union option (the select only offers valid ones). */
  function setGeneralChoice(
    key:
      | 'popupVerticalTextPosition'
      | 'termDisplayMode'
      | 'popupCurrentIndicatorMode'
      | 'popupActionBarVisibility'
      | 'popupActionBarLocation',
    value: string
  ) {
    set((p) => ((p.general as Record<string, unknown>)[key] = value));
  }

  function setSourceType(index: number, type: string) {
    setSource(index, { type: type as AudioSourceOptions['type'] });
  }

  const actionLabel = (action: string) => `dict.action.${action as HotkeyAction}` as const;

  // Scanning inputs (ScanInputsController)

  function setInput(index: number, change: (input: ScanningInput) => void) {
    set((p) => {
      p.scanning.inputs = p.scanning.inputs.map((input, i) => {
        if (i !== index) return input;
        const next = structuredClone(input);
        change(next);
        return next;
      });
    });
  }

  /** ScanInputsController.createDefaultMouseInput */
  function addInput() {
    set((p) => {
      p.scanning.inputs = [
        ...p.scanning.inputs,
        {
          include: '',
          exclude: '',
          types: { mouse: true, touch: false, pen: false },
          options: {
            showAdvanced: false,
            searchTerms: true,
            searchKanji: true,
            scanOnTouchTap: true,
            scanOnTouchMove: false,
            scanOnTouchPress: false,
            scanOnTouchRelease: false,
            scanOnPenMove: true,
            scanOnPenHover: false,
            scanOnPenReleaseHover: false,
            scanOnPenPress: true,
            scanOnPenRelease: false,
            preventTouchScrolling: true,
            preventPenScrolling: true,
            minimumTouchTime: 0
          }
        }
      ];
    });
  }

  function removeInput(index: number) {
    set((p) => (p.scanning.inputs = p.scanning.inputs.filter((_, i) => i !== index)));
  }

  function moveInput(index: number, by: -1 | 1) {
    set((p) => {
      const inputs = [...p.scanning.inputs];
      const [input] = inputs.splice(index, 1);
      inputs.splice(index + by, 0, input);
      p.scanning.inputs = inputs;
    });
  }

  const modifierOrder = ['meta', 'ctrl', 'alt', 'shift'];
  const splitModifiers = (value: string) =>
    value
      .split(/[,;\s]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

  /** HotkeyUtil.sortModifiers, joined as ScanInputField._joinModifiers does. */
  function joinModifiers(modifiers: Iterable<string>) {
    const rank = (m: string) =>
      m.startsWith('mouse') ? 10 + Number(m.slice(5)) : modifierOrder.indexOf(m);
    return [...new Set(modifiers)].sort((a, b) => rank(a) - rank(b)).join(', ');
  }

  function modifiersLabel(value: string) {
    return splitModifiers(value)
      .map((m) => (m.startsWith('mouse') ? `Mouse ${m.slice(5)}` : m[0].toUpperCase() + m.slice(1)))
      .join(' + ');
  }

  function addModifiers(index: number, field: 'include' | 'exclude', modifiers: string[]) {
    setInput(index, (input) => {
      input[field] = joinModifiers([...splitModifiers(input[field]), ...modifiers]);
    });
  }

  /** KeyboardMouseInputField._onModifierKeyDown: modifier keys add up; Escape or Backspace clears. */
  function inputKeydown(event: KeyboardEvent, index: number, field: 'include' | 'exclude') {
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.code === 'Escape' || event.code === 'Backspace') {
      setInput(index, (input) => (input[field] = ''));
      return;
    }
    const modifiers = getActiveModifiers(event);
    // Its Meta key hack: Shift + Alt can report as Meta on some systems.
    if (
      !modifiers.includes('meta') &&
      event.key === 'Meta' &&
      !(modifiers.length === 2 && modifiers.includes('shift') && modifiers.includes('alt'))
    ) {
      modifiers.push('meta');
    }
    if (modifiers.length) addModifiers(index, field, modifiers);
  }

  /** KeyboardMouseInputField's mouse button: the pressed buttons add up, for a type the input has. */
  function inputPointerDown(
    event: PointerEvent,
    input: ScanningInput,
    index: number,
    field: 'include' | 'exclude'
  ) {
    if (!event.isPrimary) return;
    const type = event.pointerType as keyof ScanningInput['types'];
    if (!input.types[type]) return;
    event.preventDefault();
    const buttons: string[] = [];
    for (let i = 0; i < 6; i++) if (event.buttons & (1 << i)) buttons.push(`mouse${i}`);
    addModifiers(index, field, buttons);
  }

  function setInputOption(
    index: number,
    key: keyof ScanningInput['options'],
    value: boolean | number
  ) {
    setInput(index, (input) => ((input.options as Record<string, boolean | number>)[key] = value));
  }

  const inputFields = [
    ['include', 'dict.inputInclude'],
    ['exclude', 'dict.inputExclude']
  ] as const;

  function setInputType(index: number, type: keyof ScanningInput['types'], on: boolean) {
    setInput(index, (input) => (input.types[type] = on));
  }

  function setFallbackSound(value: string) {
    set(
      (p) => (p.audio.fallbackSoundType = value === 'click' || value === 'bloop' ? value : 'none')
    );
  }

  function setPrevent(
    group: 'preventMiddleMouse' | 'preventBackForward',
    key: 'onWebPages' | 'onPopupPages',
    value: boolean
  ) {
    set((p) => (p.scanning[group] = { ...p.scanning[group], [key]: value }));
  }

  function setSource(index: number, change: Partial<AudioSourceOptions>) {
    set((p) => {
      p.audio.sources = p.audio.sources.map((source, i) =>
        i === index ? { ...source, ...change } : source
      );
    });
  }

  function addSource() {
    set((p) => (p.audio.sources = [...p.audio.sources, { type: 'jpod101', url: '', voice: '' }]));
  }

  function removeSource(index: number) {
    set((p) => (p.audio.sources = p.audio.sources.filter((_, i) => i !== index)));
  }

  function captureKey(event: KeyboardEvent, index: number) {
    if (listening !== index) return;
    event.preventDefault();
    event.stopPropagation();
    if (/^(Shift|Control|Alt|Meta)/.test(event.code)) return;
    const key = event.code === 'Backspace' || event.code === 'Delete' ? null : event.code;
    const modifiers = key ? eventModifiers(event) : [];
    listening = -1;
    set((p) => {
      p.inputs.hotkeys = p.inputs.hotkeys.map((hotkey, i) =>
        i === index ? { ...hotkey, key, modifiers } : hotkey
      );
    });
  }

  /** addNote / viewNotes take a card format (its index in `anki.cardFormats`), as in Yomitan. */
  const ankiActions = ['addNote', 'viewNotes'];
  $: cardFormats = dictionaryAnkiSettings($dictionaryAnki$).cardFormats;

  function setHotkeyArgument(index: number, argument: string) {
    set((p) => {
      p.inputs.hotkeys = p.inputs.hotkeys.map((hotkey, i) =>
        i === index ? { ...hotkey, argument } : hotkey
      );
    });
  }

  /** KeyboardShortcutController: a new shortcut, in the scopes its action has. */
  function addHotkey(action: HotkeyAction) {
    set((p) => {
      p.inputs.hotkeys = [
        ...p.inputs.hotkeys,
        {
          action,
          argument: '',
          key: null,
          modifiers: [],
          scopes: hotkeyScope(action) === 'web' ? ['web'] : ['popup', 'search'],
          enabled: true
        }
      ];
    });
  }

  function removeHotkey(index: number) {
    set((p) => (p.inputs.hotkeys = p.inputs.hotkeys.filter((_, i) => i !== index)));
  }

  function setHotkeyEnabled(index: number, enabled: boolean) {
    set((p) => {
      p.inputs.hotkeys = p.inputs.hotkeys.map((hotkey, i) =>
        i === index ? { ...hotkey, enabled } : hotkey
      );
    });
  }
</script>

{#if profile && general && scanning}
  <SettingsSection
    id="dictionary-popup"
    keywords="popup size position furigana pitch frequency css"
  >
    <SettingsItemGroup title={$t$('dict.fontSize')}>
      <input
        class="app-input dict-number"
        type="number"
        min="8"
        max="64"
        aria-label={$t$('dict.fontSize')}
        value={general.fontSize}
        on:change={(e) => setGeneral('fontSize', number(e.currentTarget.value, 8, 64))}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.popupDisplay')}>
      <select
        class="app-input"
        aria-label={$t$('dict.popupDisplay')}
        value={general.popupDisplayMode}
        on:change={(e) =>
          setGeneral(
            'popupDisplayMode',
            e.currentTarget.value === 'full-width' ? 'full-width' : 'default'
          )}
      >
        {#each selects.displayMode as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.sheetPosition')}>
      <select
        class="app-input"
        aria-label={$t$('dict.sheetPosition')}
        value={general.popupFullWidthPosition}
        on:change={(e) =>
          setGeneral('popupFullWidthPosition', e.currentTarget.value === 'top' ? 'top' : 'bottom')}
      >
        {#each selects.fullWidthPosition as [id, label]}<option value={id}>{$t$(label)}</option
          >{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.popupSize')}>
      <span class="dict-pair">
        <input
          class="app-input dict-number"
          type="number"
          min="100"
          aria-label={$t$('dict.width')}
          value={general.popupWidth}
          on:change={(e) => setGeneral('popupWidth', number(e.currentTarget.value, 100))}
        />
        <span aria-hidden="true">×</span>
        <input
          class="app-input dict-number"
          type="number"
          min="100"
          aria-label={$t$('dict.height')}
          value={general.popupHeight}
          on:change={(e) => setGeneral('popupHeight', number(e.currentTarget.value, 100))}
        />
      </span>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scale')}>
      <input
        class="app-input dict-number"
        type="number"
        min="0.5"
        max="4"
        step="0.1"
        aria-label={$t$('dict.scale')}
        value={general.popupScalingFactor}
        on:change={(e) =>
          setGeneral('popupScalingFactor', number(e.currentTarget.value, 0.5, 4, 0.1))}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scaleWithZoom')} tooltip={$t$('dict.scaleWithZoomHint')}>
      <Switch
        checked={general.popupScaleRelativeToPageZoom}
        aria-label={$t$('dict.scaleWithZoom')}
        onchange={(next) => setGeneral('popupScaleRelativeToPageZoom', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t$('dict.scaleWithViewport')}
      tooltip={$t$('dict.scaleWithViewportHint')}
    >
      <Switch
        checked={general.popupScaleRelativeToVisualViewport}
        aria-label={$t$('dict.scaleWithViewport')}
        onchange={(next) => setGeneral('popupScaleRelativeToVisualViewport', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.fontFamily')} tooltip={$t$('dict.fontFamilyHint')}>
      <input
        class="app-input"
        spellcheck="false"
        autocomplete="off"
        aria-label={$t$('dict.fontFamily')}
        value={general.fontFamily}
        on:change={(e) => setGeneral('fontFamily', e.currentTarget.value.trim())}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.indicator')}>
      <select
        class="app-input"
        aria-label={$t$('dict.indicator')}
        value={general.popupCurrentIndicatorMode}
        on:change={(e) => setGeneralChoice('popupCurrentIndicatorMode', e.currentTarget.value)}
      >
        {#each selects.indicator as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.actionBar')} tooltip={$t$('dict.actionBarHint')}>
      <span class="dict-pair">
        <select
          class="app-input"
          aria-label={$t$('dict.actionBarVisibility')}
          value={general.popupActionBarVisibility}
          on:change={(e) => setGeneralChoice('popupActionBarVisibility', e.currentTarget.value)}
        >
          {#each selects.actionBarVisibility as [id, label]}<option value={id}>{$t$(label)}</option
            >{/each}
        </select>
        <select
          class="app-input"
          aria-label={$t$('dict.actionBarLocation')}
          value={general.popupActionBarLocation}
          on:change={(e) => setGeneralChoice('popupActionBarLocation', e.currentTarget.value)}
        >
          {#each selects.actionBarLocation as [id, label]}<option value={id}>{$t$(label)}</option
            >{/each}
        </select>
      </span>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.horizontalPosition')}>
      <select
        class="app-input"
        aria-label={$t$('dict.horizontalPosition')}
        value={general.popupHorizontalTextPosition}
        on:change={(e) =>
          setGeneral(
            'popupHorizontalTextPosition',
            e.currentTarget.value === 'above' ? 'above' : 'below'
          )}
      >
        {#each selects.horizontal as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.verticalPosition')}>
      <select
        class="app-input"
        aria-label={$t$('dict.verticalPosition')}
        value={general.popupVerticalTextPosition}
        on:change={(e) => setGeneralChoice('popupVerticalTextPosition', e.currentTarget.value)}
      >
        {#each selects.vertical as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.termDisplay')}>
      <select
        class="app-input"
        aria-label={$t$('dict.termDisplay')}
        value={general.termDisplayMode}
        on:change={(e) => setGeneralChoice('termDisplayMode', e.currentTarget.value)}
      >
        {#each selects.termDisplay as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.glossaryLayout')}>
      <select
        class="app-input"
        aria-label={$t$('dict.glossaryLayout')}
        value={general.glossaryLayoutMode}
        on:change={(e) =>
          setGeneral(
            'glossaryLayoutMode',
            e.currentTarget.value === 'compact' ? 'compact' : 'default'
          )}
      >
        {#each selects.glossary as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.compactTags')}>
      <Switch
        checked={general.compactTags}
        aria-label={$t$('dict.compactTags')}
        onchange={(next) => setGeneral('compactTags', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.frequencyDisplay')}>
      <select
        class="app-input"
        aria-label={$t$('dict.frequencyDisplay')}
        value={general.frequencyDisplayMode.includes('tags') ? 'split-tags-grouped' : 'list'}
        on:change={(e) =>
          setGeneral(
            'frequencyDisplayMode',
            e.currentTarget.value === 'list' ? 'list' : 'split-tags-grouped'
          )}
      >
        {#each selects.frequency as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.averageFrequency')}>
      <Switch
        checked={general.averageFrequency}
        aria-label={$t$('dict.averageFrequency')}
        onchange={(next) => setGeneral('averageFrequency', next)}
      />
    </SettingsItemGroup>
    {#each pitchToggles as [key, label]}
      <SettingsItemGroup title={$t$(label)}>
        <Switch
          checked={general[key]}
          aria-label={$t$(label)}
          onchange={(next) => setGeneral(key, next)}
        />
      </SettingsItemGroup>
    {/each}
    <SettingsItemGroup title={$t$('dict.customCss')} wide>
      <textarea
        class="app-input dict-css"
        rows="4"
        spellcheck="false"
        aria-label={$t$('dict.customCss')}
        value={general.customPopupCss}
        on:change={(e) => setGeneral('customPopupCss', e.currentTarget.value)}
      />
    </SettingsItemGroup>
  </SettingsSection>

  <SettingsSection
    id="dictionary-scanning"
    keywords="scan shift hover tap modifier middle mouse delay length"
  >
    <SettingsItemGroup title={$t$('dict.scanInputs')} tooltip={$t$('dict.scanInputsHint')} wide>
      <ol class="dict-inputs">
        {#each scanning.inputs as input, index}
          <li class="dict-input">
            <div class="dict-input-head">
              <span class="dict-input-index">{String(index + 1).padStart(2, '0')}</span>
              <span class="dict-actions">
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  on:click={() =>
                    setInputOption(index, 'showAdvanced', !input.options.showAdvanced)}
                >
                  {$t$(input.options.showAdvanced ? 'dict.hideAdvanced' : 'dict.showAdvanced')}
                </button>
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  disabled={index === 0}
                  on:click={() => moveInput(index, -1)}>{$t$('dict.inputMoveUp')}</button
                >
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  disabled={index === scanning.inputs.length - 1}
                  on:click={() => moveInput(index, 1)}>{$t$('dict.inputMoveDown')}</button
                >
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  aria-label={$t$('dict.remove')}
                  on:click={() => removeInput(index)}
                >
                  <Fa icon={faXmark} />
                </button>
              </span>
            </div>
            {#each inputFields as [field, label]}
              <div class="dict-input-row">
                <span class="dict-input-label">{$t$(label)}</span>
                <span class="dict-row dict-input-field">
                  <input
                    class="app-input dict-grow"
                    readonly
                    placeholder={$t$('dict.inputNone')}
                    aria-label={$t$(label)}
                    title={$t$('dict.inputKeyHint')}
                    value={modifiersLabel(input[field])}
                    on:keydown={(e) => inputKeydown(e, index, field)}
                  />
                  <button
                    type="button"
                    class="app-button"
                    title={$t$('dict.inputMouseHint')}
                    on:pointerdown={(e) => inputPointerDown(e, input, index, field)}
                    on:mousedown|preventDefault
                    on:mouseup|preventDefault
                    on:contextmenu|preventDefault
                  >
                    {$t$('dict.inputButton')}
                  </button>
                  <button
                    type="button"
                    class="app-button app-button-quiet"
                    disabled={!input[field]}
                    on:click={() => setInput(index, (next) => (next[field] = ''))}
                  >
                    {$t$('dict.inputClear')}
                  </button>
                </span>
              </div>
            {/each}
            <div class="dict-input-row">
              <span class="dict-input-label">{$t$('dict.inputTypes')}</span>
              <span class="dict-checks">
                {#each inputTypes as [type, label]}
                  <label class="dict-check">
                    <input
                      type="checkbox"
                      checked={input.types[type]}
                      on:change={(e) => setInputType(index, type, e.currentTarget.checked)}
                    />
                    {$t$(label)}
                  </label>
                {/each}
              </span>
            </div>
            {#if input.options.showAdvanced}
              {#each inputOptionGroups as [groupLabel, options]}
                <div class="dict-input-row">
                  <span class="dict-input-label">{$t$(groupLabel)}</span>
                  <span class="dict-checks">
                    {#each options as [key, label]}
                      <label class="dict-check">
                        <input
                          type="checkbox"
                          checked={input.options[key]}
                          on:change={(e) => setInputOption(index, key, e.currentTarget.checked)}
                        />
                        {$t$(label)}
                      </label>
                    {/each}
                    {#if groupLabel === 'dict.inputTouchOptions'}
                      <label class="dict-check">
                        {$t$('dict.minimumTouchTime')}
                        <input
                          class="app-input dict-number"
                          type="number"
                          min="0"
                          value={input.options.minimumTouchTime}
                          on:change={(e) =>
                            setInputOption(
                              index,
                              'minimumTouchTime',
                              number(e.currentTarget.value, 0)
                            )}
                        />
                      </label>
                    {/if}
                  </span>
                </div>
              {/each}
            {/if}
          </li>
        {/each}
      </ol>
      <span class="dict-actions">
        <button type="button" class="app-button" on:click={addInput}>
          {$t$('dict.addInput')}
        </button>
      </span>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scanWithoutMove')}>
      <Switch
        checked={scanning.scanWithoutMousemove}
        aria-label={$t$('dict.scanWithoutMove')}
        onchange={(next) => setScanning('scanWithoutMousemove', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scanDelay')}>
      <input
        class="app-input dict-number"
        type="number"
        min="0"
        aria-label={$t$('dict.scanDelay')}
        value={scanning.delay}
        on:change={(e) => setScanning('delay', number(e.currentTarget.value, 0, 5000))}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scanLength')}>
      <input
        class="app-input dict-number"
        type="number"
        min="1"
        max="100"
        aria-label={$t$('dict.scanLength')}
        value={scanning.length}
        on:change={(e) => setScanning('length', number(e.currentTarget.value, 1, 100))}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.layoutAware')}>
      <Switch
        checked={scanning.layoutAwareScan}
        aria-label={$t$('dict.layoutAware')}
        onchange={(next) => setScanning('layoutAwareScan', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.autoHide')}>
      <Switch
        checked={scanning.autoHideResults}
        aria-label={$t$('dict.autoHide')}
        onchange={(next) => setScanning('autoHideResults', next)}
      />
    </SettingsItemGroup>
    {#if scanning.autoHideResults}
      <SettingsItemGroup title={$t$('dict.hideDelay')}>
        <input
          class="app-input dict-number"
          type="number"
          min="0"
          aria-label={$t$('dict.hideDelay')}
          value={scanning.hideDelay}
          on:change={(e) => setScanning('hideDelay', number(e.currentTarget.value, 0, 60000))}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t$('dict.nesting')}>
      <input
        class="app-input dict-number"
        type="number"
        min="0"
        max="20"
        aria-label={$t$('dict.nesting')}
        value={scanning.popupNestingMaxDepth}
        on:change={(e) => setScanning('popupNestingMaxDepth', number(e.currentTarget.value, 0, 20))}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.enableOnPopupExpressions')}>
      <Switch
        checked={scanning.enableOnPopupExpressions}
        aria-label={$t$('dict.enableOnPopupExpressions')}
        onchange={(next) => setScanning('enableOnPopupExpressions', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scanResolution')} tooltip={$t$('dict.scanResolutionHint')}>
      <select
        class="app-input"
        aria-label={$t$('dict.scanResolution')}
        value={scanning.scanResolution}
        on:change={(e) =>
          setScanning('scanResolution', e.currentTarget.value === 'word' ? 'word' : 'character')}
      >
        {#each selects.scanResolution as [id, label]}<option value={id}>{$t$(label)}</option>{/each}
      </select>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.selectText')}>
      <Switch
        checked={scanning.selectText}
        aria-label={$t$('dict.selectText')}
        onchange={(next) => setScanning('selectText', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.deepDomScan')} tooltip={$t$('dict.deepDomScanHint')}>
      <Switch
        checked={scanning.deepDomScan}
        aria-label={$t$('dict.deepDomScan')}
        onchange={(next) => setScanning('deepDomScan', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t$('dict.matchTypePrefix')}
      tooltip={$t$('dict.matchTypePrefixHint')}
    >
      <Switch
        checked={scanning.matchTypePrefix}
        aria-label={$t$('dict.matchTypePrefix')}
        onchange={(next) => setScanning('matchTypePrefix', next)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.hideOnExit')} tooltip={$t$('dict.hideOnExitHint')}>
      <Switch
        checked={scanning.hidePopupOnCursorExit}
        aria-label={$t$('dict.hideOnExit')}
        onchange={(next) => setScanning('hidePopupOnCursorExit', next)}
      />
    </SettingsItemGroup>
    {#if scanning.hidePopupOnCursorExit}
      <SettingsItemGroup title={$t$('dict.hideOnExitDelay')}>
        <input
          class="app-input dict-number"
          type="number"
          min="0"
          aria-label={$t$('dict.hideOnExitDelay')}
          value={scanning.hidePopupOnCursorExitDelay}
          on:change={(e) =>
            setScanning('hidePopupOnCursorExitDelay', number(e.currentTarget.value, 0, 60000))}
        />
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup title={$t$('dict.reducedMotion')} tooltip={$t$('dict.reducedMotionHint')}>
      <Switch
        checked={scanning.reducedMotionScrolling}
        aria-label={$t$('dict.reducedMotion')}
        onchange={(next) => setScanning('reducedMotionScrolling', next)}
      />
    </SettingsItemGroup>
    {#if scanning.reducedMotionScrolling}
      <SettingsItemGroup title={$t$('dict.reducedMotionScale')}>
        <select
          class="app-input"
          aria-label={$t$('dict.reducedMotionScale')}
          value={scanning.reducedMotionScrollingScale}
          on:change={(e) =>
            setScanning('reducedMotionScrollingScale', number(e.currentTarget.value, 0.4, 1, 0.1))}
        >
          {#each reducedMotionScales as scale}
            <option value={scale}>{Math.round(scale * 100)}%</option>
          {/each}
        </select>
      </SettingsItemGroup>
      <SettingsItemGroup title={$t$('dict.reducedMotionThreshold')}>
        <input
          class="app-input dict-number"
          type="number"
          min="0"
          aria-label={$t$('dict.reducedMotionThreshold')}
          value={scanning.reducedMotionScrollingSwipeThreshold}
          on:change={(e) =>
            setScanning('reducedMotionScrollingSwipeThreshold', number(e.currentTarget.value, 0))}
        />
      </SettingsItemGroup>
    {/if}
    {#each preventToggles as [group, key, label]}
      <SettingsItemGroup title={$t$(label)}>
        <Switch
          checked={scanning[group][key]}
          aria-label={$t$(label)}
          onchange={(next) => setPrevent(group, key, next)}
        />
      </SettingsItemGroup>
    {/each}
  </SettingsSection>

  <SettingsSection id="dictionary-audio" keywords="audio pronunciation jpod101 wiktionary voice">
    <SettingsItemGroup title={$t$('dict.audioEnabled')}>
      <Switch
        checked={profile.audio.enabled}
        aria-label={$t$('dict.audioEnabled')}
        onchange={(next) => set((p) => (p.audio.enabled = next))}
      />
    </SettingsItemGroup>
    {#if profile.audio.enabled}
      <SettingsItemGroup title={$t$('dict.autoPlay')}>
        <Switch
          checked={profile.audio.autoPlay}
          aria-label={$t$('dict.autoPlay')}
          onchange={(next) => set((p) => (p.audio.autoPlay = next))}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t$('dict.volume')}>
        <input
          type="range"
          min="0"
          max="100"
          aria-label={$t$('dict.volume')}
          value={profile.audio.volume}
          on:change={(e) => set((p) => (p.audio.volume = number(e.currentTarget.value, 0, 100)))}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t$('dict.fallbackSound')} tooltip={$t$('dict.fallbackSoundHint')}>
        <select
          class="app-input"
          aria-label={$t$('dict.fallbackSound')}
          value={profile.audio.fallbackSoundType}
          on:change={(e) => setFallbackSound(e.currentTarget.value)}
        >
          {#each selects.fallbackSound as [id, label]}<option value={id}>{$t$(label)}</option
            >{/each}
        </select>
      </SettingsItemGroup>
      <SettingsItemGroup title={$t$('dict.defaultSources')}>
        <Switch
          checked={profile.audio.enableDefaultAudioSources}
          aria-label={$t$('dict.defaultSources')}
          onchange={(next) => set((p) => (p.audio.enableDefaultAudioSources = next))}
        />
      </SettingsItemGroup>
      <SettingsItemGroup title={$t$('dict.audioSources')} wide>
        {#each profile.audio.sources as source, index}
          <div class="dict-row">
            <select
              class="app-input"
              aria-label={$t$('dict.audioSource')}
              value={source.type}
              on:change={(e) => setSourceType(index, e.currentTarget.value)}
            >
              {#each audioSourceTypes as type}
                <option value={type}>{$t$(`dict.source.${type}`)}</option>
              {/each}
              {#if !audioSourceTypes.some((type) => type === source.type)}
                <option value={source.type}>{source.type} ({$t$('dict.unsupported')})</option>
              {/if}
            </select>
            {#if source.type === 'custom' || source.type === 'custom-json'}
              <input
                class="app-input dict-grow"
                placeholder="https://…?term={'{term}'}&reading={'{reading}'}"
                aria-label={$t$('dict.audioUrl')}
                value={source.url}
                on:change={(e) => setSource(index, { url: e.currentTarget.value.trim() })}
              />
            {:else if source.type.startsWith('text-to-speech')}
              <select
                class="app-input dict-grow"
                aria-label={$t$('dict.voice')}
                value={source.voice}
                on:change={(e) => setSource(index, { voice: e.currentTarget.value })}
              >
                <option value="">{$t$('dict.none')}</option>
                {#each voices as voice}
                  <option value={voice.voiceURI}>{voice.name}</option>
                {/each}
              </select>
            {/if}
            <button
              type="button"
              class="app-button app-button-quiet"
              aria-label={$t$('dict.remove')}
              on:click={() => removeSource(index)}
            >
              <Fa icon={faXmark} />
            </button>
          </div>
        {/each}
        <span class="dict-actions">
          <button type="button" class="app-button" on:click={addSource}>
            {$t$('dict.addSource')}
          </button>
          <button
            type="button"
            class="app-button app-button-quiet"
            on:click={() => profile && playTermAudio('読む', 'よむ', profile.audio)}
          >
            {$t$('dict.testAudio')}
          </button>
        </span>
      </SettingsItemGroup>
    {/if}
  </SettingsSection>

  <SettingsSection id="dictionary-shortcuts" keywords="hotkey keyboard shortcut escape selected">
    <ul class="dict-hotkeys">
      {#each profile.inputs.hotkeys as hotkey, index}
        {#if isSupportedHotkey(hotkey)}
          <li class="dict-hotkey">
            <span class="dict-hotkey-action">{$t$(actionLabel(hotkey.action))}</span>
            {#if ankiActions.includes(hotkey.action)}
              <select
                class="app-input dict-hotkey-format"
                aria-label={$t$('dict.hotkeyFormat', { action: $t$(actionLabel(hotkey.action)) })}
                value={hotkey.argument}
                on:change={(e) => setHotkeyArgument(index, e.currentTarget.value)}
              >
                {#each cardFormats as format, formatIndex}
                  <option value={`${formatIndex}`}>{format.name}</option>
                {/each}
              </select>
            {/if}
            <button
              type="button"
              class="app-button dict-key"
              aria-pressed={listening === index}
              on:click={() => (listening = listening === index ? -1 : index)}
              on:keydown={(e) => captureKey(e, index)}
              on:blur={() => listening === index && (listening = -1)}
            >
              {listening === index
                ? $t$('dict.pressKey')
                : hotkeyLabel(hotkey) || $t$('dict.noKey')}
            </button>
            <Switch
              checked={hotkey.enabled}
              aria-label={$t$(actionLabel(hotkey.action))}
              onchange={(next) => setHotkeyEnabled(index, next)}
            />
            <button
              type="button"
              class="app-button app-button-quiet"
              aria-label={$t$('dict.remove')}
              on:click={() => removeHotkey(index)}
            >
              <Fa icon={faXmark} />
            </button>
          </li>
        {/if}
      {/each}
    </ul>
    <span class="dict-row dict-hotkey-add">
      <select
        class="app-input"
        aria-label={$t$('dict.shortcutAction')}
        bind:value={newHotkeyAction}
      >
        {#each hotkeyActions as action}<option value={action}>{$t$(actionLabel(action))}</option
          >{/each}
      </select>
      <button type="button" class="app-button" on:click={() => addHotkey(newHotkeyAction)}>
        {$t$('dict.addShortcut')}
      </button>
    </span>
  </SettingsSection>
{/if}

<style>
  .dict-number {
    width: 6rem;
  }

  .dict-pair {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--app-muted-fg);
  }

  .dict-css {
    width: 100%;
    min-height: 6rem;
    font-family: ui-monospace, monospace;
    font-size: var(--type-small);
  }

  .dict-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .dict-grow {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .dict-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .dict-hotkeys {
    border-top: 2px solid var(--font-color);
  }

  .dict-hotkey {
    display: flex;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .dict-hotkey-action {
    flex: 1 1 auto;
    color: var(--font-color);
    font-size: var(--type-body);
  }

  .dict-hotkey-format {
    width: auto;
    max-width: 10rem;
  }

  .dict-hotkey-add {
    margin-top: 0.75rem;
  }

  .dict-inputs {
    border-top: 2px solid var(--font-color);
    margin-bottom: 0.75rem;
  }

  .dict-input {
    padding: 0.5rem 0 0.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .dict-input-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .dict-input-index {
    color: var(--accent-strong-color);
    font-size: var(--type-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .dict-input-row {
    display: grid;
    grid-template-columns: minmax(7rem, 10rem) 1fr;
    gap: 0.5rem;
    align-items: start;
    margin-top: 0.5rem;
  }

  .dict-input-label {
    padding-top: 0.4rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .dict-input-field {
    margin-bottom: 0;
  }

  .dict-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding-top: 0.35rem;
  }

  .dict-check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--font-color);
    font-size: var(--type-small);
  }

  @media (max-width: 639px) {
    .dict-input-row {
      grid-template-columns: 1fr;
    }
  }

  .dict-key {
    min-width: 8rem;
    font-variant-numeric: tabular-nums;
  }
</style>
