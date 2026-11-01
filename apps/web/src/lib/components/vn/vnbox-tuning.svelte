<script lang="ts">
  /**
   * The /v player's Tuning sheet for Windows games: VNBox's address settings that change how
   * smoothly a game plays (vnboxPlayerUrl's `tuning`), saved per game in this browser, and the
   * speed VNBox reports. Not upstream.
   */
  import { untrack } from 'svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
  import {
    compatFromTuning,
    compatParams,
    validDesktop,
    validDll,
    validEnv,
    validReg
  } from '$lib/data/vn/windows-game';
  import {
    knobGroups,
    knobParams,
    loadVnboxKnobs,
    splitTuning,
    validKnobValue,
    type Knob
  } from '$lib/data/vn/vnbox-options';

  interface Props {
    /** The game's saved tuning, `a=b&c=d` */
    tuning: string;
    /** The player frame, read for VNBox's MIPS and stats lines */
    frame?: HTMLIFrameElement;
    onapply: (tuning: string) => void;
  }

  let { tuning, frame, onapply }: Props = $props();

  const pairs = untrack(() => tuning)
    .split('&')
    .filter(Boolean);

  let compat = $state(compatFromTuning(pairs));

  const rendererOptions = [
    { id: '', text: 'Default' },
    { id: 'gl', text: 'OpenGL' },
    { id: 'gdi', text: 'GDI' }
  ];
  const versionOptions = [
    { id: '', text: 'Default' },
    ...[
      ['win95', '95'],
      ['win98', '98'],
      ['winme', 'ME'],
      ['win2k', '2000'],
      ['winxp', 'XP'],
      ['win7', '7'],
      ['win10', '10']
    ].map(([id, text]) => ({ id, text }))
  ];
  const dllModes = [
    { id: 'n', text: 'Native' },
    { id: 'b', text: 'Built-in' },
    { id: '', text: 'Off' }
  ];
  const regTypes = [
    { id: 'REG_SZ', text: 'Text' },
    { id: 'REG_DWORD', text: 'Number' }
  ];

  // Built from the engine's vnbox-options.json once per opening (hand-written list without it).
  let knobs: Knob[] | undefined = $state();
  let values: Record<string, string> = $state({});
  let extra = $state('');

  $effect(() => {
    let live = true;

    loadVnboxKnobs().then((loaded) => {
      if (!live) return;
      ({ values, extra } = splitTuning(
        loaded,
        untrack(() => tuning)
      ));
      knobs = loaded;
    });
    return () => (live = false);
  });

  const value = (knob: Knob) => values[knob.key] ?? knob.initial;

  function set(knob: Knob, next: string) {
    // A typed number stays as typed (knobParams leaves out the default and bad ones).
    if (next === knob.initial && !knob.number) delete values[knob.key];
    else values[knob.key] = next;
  }

  function apply() {
    onapply(
      [
        ...knobParams(knobs!, values),
        ...compatParams(compat),
        extra.trim().replace(/^[?&]+|&+$/g, '')
      ]
        .filter(Boolean)
        .join('&')
    );
  }

  let mips: string | undefined = $state();
  let stats: string[] = $state([]);

  // VNBox puts its speed in the frame's title each second ("BoxedWine 120 MIPS") and, with
  // stats=1, a `[stats]` line in its log every 2 s.
  $effect(() => {
    const read = () => {
      const doc = frame?.contentDocument;
      const log = (doc?.getElementById('output') as HTMLTextAreaElement | null)?.value ?? '';
      const at = log.lastIndexOf('[stats]');

      mips = doc?.title.match(/(\d+) MIPS/)?.[1];
      stats =
        at < 0
          ? []
          : log
              .slice(at + 8)
              .split('\n')[0]
              .split(' | ');
    };
    const timer = setInterval(read, 1000);

    read();
    return () => clearInterval(timer);
  });
</script>

<div class="tuning">
  <SectionHead number={1} title="Speed now" level="h3" />
  <p class="tuning-mips">
    {#if mips}
      <strong>{mips}</strong> MIPS
    {:else}
      <span class="tuning-muted">Waiting for the game to report its speed</span>
    {/if}
  </p>
  {#if stats.length}
    <ul class="tuning-stats" aria-label="Last stats line">
      {#each stats as part}
        <li>{part}</li>
      {/each}
    </ul>
  {/if}

  <SectionHead number={2} title="Settings" level="h3" />
  {#if !knobs}
    <p class="tuning-muted">Loading VNBox's settings</p>
  {:else}
    {#each knobGroups(knobs) as group (group.name)}
      {#if group.name}
        <h4 class="tuning-group">{group.name}</h4>
      {/if}
      {#each group.knobs as knob (knob.key)}
        <SettingsItemGroup
          title={knob.title}
          tooltip="{knob.hint} Default: {knob.shown}."
          wide={!!knob.options && knob.options.length > 2}
        >
          {#if knob.options}
            <ButtonToggleGroup
              options={knob.options}
              bind:selectedOptionId={() => value(knob), (next) => set(knob, next)}
            />
          {:else if knob.on !== undefined}
            <ButtonToggleGroup
              options={optionsForToggle}
              bind:selectedOptionId={
                () => value(knob) === knob.on, (on) => set(knob, on ? knob.on! : knob.off!)
              }
            />
          {:else if knob.number}
            <input
              class="app-input"
              type="number"
              aria-label={knob.title}
              min={knob.number.min}
              max={knob.number.max}
              step={knob.number.int ? 1 : 'any'}
              value={value(knob)}
              oninput={(event) => set(knob, event.currentTarget.value.trim())}
            />
            {#if !validKnobValue(knob, value(knob))}
              <p class="compat-error">
                Not a {knob.number.int ? 'whole ' : ''}number from {knob.number.min} to {knob.number
                  .max}: left out.
              </p>
            {/if}
          {:else}
            <input
              class="app-input"
              aria-label={knob.title}
              placeholder="e.g. 800x600"
              pattern="\d+x\d+"
              value={value(knob)}
              oninput={(event) => set(knob, event.currentTarget.value.trim())}
            />
          {/if}
        </SettingsItemGroup>
      {/each}
    {/each}
  {/if}
  <SettingsItemGroup
    title="Extra settings"
    tooltip="Added to VNBox's address as typed (a=b&c=d), for settings not listed here. The game folder, program and hook stay. Wine fixes go under Compatibility."
    wide
  >
    <input
      class="app-input w-full"
      aria-label="Extra settings"
      placeholder="e.g. safe-memory=true&disableHideCursor=true"
      spellcheck="false"
      autocomplete="off"
      bind:value={extra}
    />
  </SettingsItemGroup>

  <SectionHead number={3} title="Compatibility" level="h3" />
  <p class="tuning-muted">
    Default doesn't undo Renderer, Windows version or registry values: pick the other value.
  </p>
  <SettingsItemGroup
    title="Renderer"
    tooltip="How Wine draws Direct3D and DirectDraw. GDI helps some older 2D games that show a black screen. Default: Wine's own (OpenGL)."
  >
    <ButtonToggleGroup options={rendererOptions} bind:selectedOptionId={compat.renderer} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Windows version"
    tooltip="The Windows version Wine reports, for games that refuse to run on a newer one. Default: Wine's own (10)."
    wide
  >
    <ButtonToggleGroup options={versionOptions} bind:selectedOptionId={compat.version} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Movies"
    tooltip="Off turns DirectShow (quartz) off, so a game that hangs on its opening movie can skip it. Some games stop instead."
  >
    <ButtonToggleGroup options={optionsForToggle} bind:selectedOptionId={compat.movies} />
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Virtual desktop"
    tooltip="Runs the game inside a Wine desktop of this size (WIDTHxHEIGHT), for games that change the screen mode. Empty: off."
  >
    <input
      class="app-input"
      aria-label="Virtual desktop size"
      placeholder="e.g. 800x600"
      bind:value={compat.desktop}
    />
    {#if compat.desktop && !validDesktop(compat.desktop)}
      <p class="compat-error">Not WIDTHxHEIGHT: left out.</p>
    {/if}
  </SettingsItemGroup>

  <SettingsItemGroup
    title="DLL overrides"
    tooltip="Which copy of a DLL Wine loads: Native (one the game ships), Built-in (Wine's) or Off. Name without .dll, e.g. d3d9."
    wide
  >
    {#each compat.dlls as dll, i}
      <div class="compat-row">
        <input
          class="app-input"
          aria-label="DLL name"
          placeholder="d3d9"
          spellcheck="false"
          bind:value={dll.name}
        />
        <ButtonToggleGroup options={dllModes} bind:selectedOptionId={dll.mode} />
        <button class="app-button app-button-quiet" onclick={() => compat.dlls.splice(i, 1)}>
          Remove
        </button>
      </div>
      {#if !validDll(dll) && dll.name}
        <p class="compat-error">Not valid: left out.</p>
      {/if}
    {/each}
    {#if compat.dlls.length < 32}
      <button
        class="app-button app-button-quiet"
        onclick={() => compat.dlls.push({ name: '', mode: 'n' })}
      >
        Add DLL
      </button>
    {/if}
  </SettingsItemGroup>

  <SettingsItemGroup
    title="Registry values"
    tooltip="Set with reg add before the game starts. Keys under HKCU\Software or HKLM\Software only; no quotes, &, |, <, >, ^ or %. An empty name sets the key's default value."
    wide
  >
    {#each compat.registry as row, i}
      <div class="compat-row">
        <input
          class="app-input compat-wide"
          aria-label="Registry key"
          placeholder="HKCU\Software\Wine\Direct3D"
          spellcheck="false"
          bind:value={row.key}
        />
        <input
          class="app-input"
          aria-label="Value name"
          placeholder="Name"
          spellcheck="false"
          bind:value={row.name}
        />
        <ButtonToggleGroup options={regTypes} bind:selectedOptionId={row.type} />
        <input
          class="app-input"
          aria-label="Value"
          placeholder={row.type === 'REG_DWORD' ? '0x1' : 'Value'}
          spellcheck="false"
          bind:value={row.value}
        />
        <button class="app-button app-button-quiet" onclick={() => compat.registry.splice(i, 1)}>
          Remove
        </button>
      </div>
      {#if !validReg(row) && (row.value || row.name)}
        <p class="compat-error">Not valid: left out.</p>
      {/if}
    {/each}
    {#if compat.registry.length < 64}
      <button
        class="app-button app-button-quiet"
        onclick={() =>
          compat.registry.push({ key: 'HKCU\\Software\\', name: '', type: 'REG_SZ', value: '' })}
      >
        Add value
      </button>
    {/if}
  </SettingsItemGroup>

  <SettingsItemGroup
    title="Environment variables"
    tooltip="Passed to Wine, e.g. WINEDEBUG=-all. DLL overrides go above, not as WINEDLLOVERRIDES."
    wide
  >
    {#each compat.env as row, i}
      <div class="compat-row">
        <input
          class="app-input"
          aria-label="Variable name"
          placeholder="NAME"
          spellcheck="false"
          bind:value={row.name}
        />
        <input
          class="app-input compat-wide"
          aria-label="Variable value"
          placeholder="Value"
          spellcheck="false"
          bind:value={row.value}
        />
        <button class="app-button app-button-quiet" onclick={() => compat.env.splice(i, 1)}>
          Remove
        </button>
      </div>
      {#if !validEnv(row) && (row.name || row.value)}
        <p class="compat-error">Not valid: left out.</p>
      {/if}
    {/each}
    {#if compat.env.length < 32}
      <button
        class="app-button app-button-quiet"
        onclick={() => compat.env.push({ name: '', value: '' })}
      >
        Add variable
      </button>
    {/if}
  </SettingsItemGroup>

  <div class="tuning-actions">
    <button class="app-button app-button-primary" disabled={!knobs} onclick={apply}
      >Apply and restart</button
    >
    <button class="app-button" onclick={() => onapply('')}>Reset</button>
  </div>
  <p class="tuning-muted tuning-note">Restarting starts the game over: save in the game first.</p>
</div>

<style>
  .tuning {
    padding-top: 1rem;
  }

  .tuning-mips {
    margin: 0.5rem 0 1rem;
    font-variant-numeric: tabular-nums;
  }

  .tuning-mips strong {
    font-size: var(--type-h2);
  }

  .tuning-muted {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .tuning-stats {
    margin: 0 0 1.25rem;
    padding: 0.5rem 0 0 0.75rem;
    border-left: 2px solid var(--accent-color);
    font-family: ui-monospace, monospace;
    font-size: var(--type-small);
    line-height: 1.5;
    list-style: none;
    overflow-wrap: anywhere;
  }

  .tuning-group {
    margin: 1rem 0 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 600;
    text-transform: uppercase;
  }

  .compat-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .compat-row .app-input {
    flex: 1 1 7rem;
    min-width: 0;
  }

  .compat-row .compat-wide {
    flex-basis: 14rem;
  }

  .compat-error {
    margin: -0.25rem 0 0.5rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .tuning-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1.25rem;
  }

  .tuning-note {
    margin-top: 0.75rem;
  }
</style>
