<script lang="ts">
  /**
   * Settings → Dictionary lookups: Popup, Scanning, Audio and Shortcuts for the built-in lookup
   * popup (components/dictionary/lookup-popup.svelte), in Yomitan's options shape. Only options
   * the popup carries out in a web page are shown. Not part of upstream.
   */
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import DictSwitch from '$lib/components/settings/dictionary-switch.svelte';
  import { profileOptions, updateProfileOptions, yomitanOptions$ } from '$lib/data/dictionary';
  import { audioSourceTypes, playTermAudio } from '$lib/data/dictionary-audio';
  import {
    eventModifiers,
    hotkeyLabel,
    isPopupHotkey,
    type PopupHotkeyAction
  } from '$lib/functions/dictionary/hotkeys';
  import { t$ } from '$lib/i18n';
  import type { AudioSourceOptions, ProfileOptions } from '$lib/vendor/yomitan/types/settings';

  $: profile = $yomitanOptions$ ? profileOptions($yomitanOptions$) : undefined;
  $: general = profile?.general;
  $: scanning = profile?.scanning;
  $: mouseIndex = scanning?.inputs.findIndex(({ types }) => types.mouse) ?? -1;
  $: touchIndex = scanning?.inputs.findIndex(({ types }) => types.touch) ?? -1;

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
    scanKey: [
      ['shift', 'Shift'],
      ['ctrl', 'Ctrl'],
      ['alt', 'Alt'],
      ['meta', 'Meta']
    ]
  } as const;

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
  function setGeneralChoice(key: 'popupVerticalTextPosition' | 'termDisplayMode', value: string) {
    set((p) => ((p.general as Record<string, unknown>)[key] = value));
  }

  function setSourceType(index: number, type: string) {
    setSource(index, { type: type as AudioSourceOptions['type'] });
  }

  const actionLabel = (action: string) => `dict.action.${action as PopupHotkeyAction}` as const;

  function setScanKey(key: string) {
    set((p) => {
      const input = p.scanning.inputs[mouseIndex];
      if (input) input.include = key;
    });
  }

  function setTouchTap(on: boolean) {
    set((p) => {
      const input = p.scanning.inputs[touchIndex];
      if (input) input.options.scanOnTouchTap = on;
    });
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
    <SettingsItemGroup title={$t$('dict.fontSize')} tooltip={$t$('dict.fontSizeHint')}>
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
    <SettingsItemGroup title={$t$('dict.popupDisplay')} tooltip={$t$('dict.popupDisplayHint')}>
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
    <SettingsItemGroup title={$t$('dict.sheetPosition')} tooltip={$t$('dict.sheetPositionHint')}>
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
    <SettingsItemGroup title={$t$('dict.popupSize')} tooltip={$t$('dict.popupSizeHint')}>
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
    <SettingsItemGroup title={$t$('dict.scale')} tooltip={$t$('dict.scaleHint')}>
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
    <SettingsItemGroup title={$t$('dict.compactTags')} tooltip={$t$('dict.compactTagsHint')}>
      <DictSwitch
        checked={general.compactTags}
        label={$t$('dict.compactTags')}
        on:change={({ detail }) => setGeneral('compactTags', detail)}
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
    <SettingsItemGroup
      title={$t$('dict.averageFrequency')}
      tooltip={$t$('dict.averageFrequencyHint')}
    >
      <DictSwitch
        checked={general.averageFrequency}
        label={$t$('dict.averageFrequency')}
        on:change={({ detail }) => setGeneral('averageFrequency', detail)}
      />
    </SettingsItemGroup>
    {#each pitchToggles as [key, label]}
      <SettingsItemGroup title={$t$(label)}>
        <DictSwitch
          checked={general[key]}
          label={$t$(label)}
          on:change={({ detail }) => setGeneral(key, detail)}
        />
      </SettingsItemGroup>
    {/each}
    <SettingsItemGroup title={$t$('dict.customCss')} tooltip={$t$('dict.customCssHint')} wide>
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

  <SettingsSection id="dictionary-scanning" keywords="scan shift hover tap modifier delay length">
    <SettingsItemGroup title={$t$('dict.scanTap')} tooltip={$t$('dict.scanTapHint')}>
      <DictSwitch
        checked={!!scanning.inputs[touchIndex]?.options.scanOnTouchTap}
        label={$t$('dict.scanTap')}
        on:change={({ detail }) => setTouchTap(detail)}
      />
    </SettingsItemGroup>
    {#if mouseIndex >= 0}
      <SettingsItemGroup title={$t$('dict.scanKey')} tooltip={$t$('dict.scanKeyHint')}>
        <select
          class="app-input"
          aria-label={$t$('dict.scanKey')}
          value={scanning.inputs[mouseIndex].include}
          on:change={(e) => setScanKey(e.currentTarget.value)}
        >
          <option value="">{$t$('dict.scanKeyNone')}</option>
          {#each selects.scanKey as [id, label]}
            <option value={id}>{label}</option>
          {/each}
          {#if scanning.inputs[mouseIndex].include && !selects.scanKey.some(([id]) => id === scanning?.inputs[mouseIndex].include)}
            <option value={scanning.inputs[mouseIndex].include}>
              {scanning.inputs[mouseIndex].include}
            </option>
          {/if}
        </select>
      </SettingsItemGroup>
    {/if}
    <SettingsItemGroup
      title={$t$('dict.scanWithoutMove')}
      tooltip={$t$('dict.scanWithoutMoveHint')}
    >
      <DictSwitch
        checked={scanning.scanWithoutMousemove}
        label={$t$('dict.scanWithoutMove')}
        on:change={({ detail }) => setScanning('scanWithoutMousemove', detail)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scanDelay')} tooltip={$t$('dict.scanDelayHint')}>
      <input
        class="app-input dict-number"
        type="number"
        min="0"
        aria-label={$t$('dict.scanDelay')}
        value={scanning.delay}
        on:change={(e) => setScanning('delay', number(e.currentTarget.value, 0, 5000))}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.scanLength')} tooltip={$t$('dict.scanLengthHint')}>
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
    <SettingsItemGroup title={$t$('dict.layoutAware')} tooltip={$t$('dict.layoutAwareHint')}>
      <DictSwitch
        checked={scanning.layoutAwareScan}
        label={$t$('dict.layoutAware')}
        on:change={({ detail }) => setScanning('layoutAwareScan', detail)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.autoHide')} tooltip={$t$('dict.autoHideHint')}>
      <DictSwitch
        checked={scanning.autoHideResults}
        label={$t$('dict.autoHide')}
        on:change={({ detail }) => setScanning('autoHideResults', detail)}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('dict.nesting')} tooltip={$t$('dict.nestingHint')}>
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
  </SettingsSection>

  <SettingsSection id="dictionary-audio" keywords="audio pronunciation jpod101 wiktionary voice">
    <SettingsItemGroup title={$t$('dict.audioEnabled')} tooltip={$t$('dict.audioEnabledHint')}>
      <DictSwitch
        checked={profile.audio.enabled}
        label={$t$('dict.audioEnabled')}
        on:change={({ detail }) => set((p) => (p.audio.enabled = detail))}
      />
    </SettingsItemGroup>
    {#if profile.audio.enabled}
      <SettingsItemGroup title={$t$('dict.autoPlay')} tooltip={$t$('dict.autoPlayHint')}>
        <DictSwitch
          checked={profile.audio.autoPlay}
          label={$t$('dict.autoPlay')}
          on:change={({ detail }) => set((p) => (p.audio.autoPlay = detail))}
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
      <SettingsItemGroup
        title={$t$('dict.defaultSources')}
        tooltip={$t$('dict.defaultSourcesHint')}
      >
        <DictSwitch
          checked={profile.audio.enableDefaultAudioSources}
          label={$t$('dict.defaultSources')}
          on:change={({ detail }) => set((p) => (p.audio.enableDefaultAudioSources = detail))}
        />
      </SettingsItemGroup>
      <SettingsItemGroup
        title={$t$('dict.audioSources')}
        tooltip={$t$('dict.audioSourcesHint')}
        wide
      >
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

  <SettingsSection id="dictionary-shortcuts" keywords="hotkey keyboard shortcut escape">
    <ul class="dict-hotkeys">
      {#each profile.inputs.hotkeys as hotkey, index}
        {#if isPopupHotkey(hotkey)}
          <li class="dict-hotkey">
            <span class="dict-hotkey-action">{$t$(actionLabel(hotkey.action))}</span>
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
            <DictSwitch
              checked={hotkey.enabled}
              label={$t$(actionLabel(hotkey.action))}
              on:change={({ detail }) => setHotkeyEnabled(index, detail)}
            />
          </li>
        {/if}
      {/each}
    </ul>
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

  .dict-key {
    min-width: 8rem;
    font-variant-numeric: tabular-nums;
  }
</style>
