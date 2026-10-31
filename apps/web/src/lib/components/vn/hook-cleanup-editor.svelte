<script lang="ts">
  /**
   * A hooked text's cleanup (hook-cleanup.ts): a preview of the last line, a suggestion from the
   * recent ones, the filters in chain order and the replace rules. Used by /v's Hooks sheet (saved
   * with the game) and /hook's settings (the WebSocket lines', or a native game's). Not upstream.
   */
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
  import {
    cleanHookLine,
    defaultRecentSize,
    filterOn,
    hookFilters,
    ruleError,
    suggestCleanup,
    type HookCleanup,
    type HookFilter
  } from '$lib/data/vn/hook-cleanup';

  interface Props {
    cleanup: HookCleanup;
    /** The last hooked line as sent, before cleanup; undefined before the first */
    last: string | undefined;
    /** Recent lines as sent, for the suggestion */
    recent: string[];
    onchange: (cleanup: HookCleanup) => void;
  }

  let { cleanup, last, recent, onchange }: Props = $props();

  const suggestion = $derived.by(() => {
    const found = suggestCleanup(recent);
    const missing = Object.keys(found ?? {}).filter(
      (key) => !filterOn(cleanup, key as HookFilter)
    ) as HookFilter[];

    return missing.length ? missing : undefined;
  });
  const titleOf = (key: HookFilter) => hookFilters.find((filter) => filter.key === key)!.title;
  const rules = $derived(cleanup.rules ?? []);

  function setRule(index: number, part: 'pattern' | 'replacement', value: string) {
    onchange({
      ...cleanup,
      rules: rules.map((rule, at) => (at === index ? { ...rule, [part]: value } : rule))
    });
  }
</script>

<div class="hc">
  <table class="hc-preview">
    <tbody>
      <tr>
        <th scope="row">Hooked</th>
        <td lang="ja">{last ?? ''}</td>
      </tr>
      <tr>
        <th scope="row">Cleaned</th>
        {#if last === undefined}
          <td class="hc-muted">Lines from the game show here.</td>
        {:else if cleanHookLine(last ?? '', cleanup)}
          <td lang="ja">{cleanHookLine(last ?? '', cleanup)}</td>
        {:else}
          <td class="hc-muted">Dropped</td>
        {/if}
      </tr>
    </tbody>
  </table>
  {#if suggestion}
    <div class="hc-suggestion">
      <p>
        <strong>Suggested</strong>
        {suggestion.map(titleOf).join(', ')}
      </p>
      <button
        class="app-button"
        onclick={() =>
          onchange({ ...cleanup, ...Object.fromEntries(suggestion.map((key) => [key, true])) })}
      >
        Apply
      </button>
    </div>
  {/if}
  <div class="hc-filters">
    {#each hookFilters as filter (filter.key)}
      <SettingsItemGroup title={filter.title} tooltip={filter.hint}>
        <ButtonToggleGroup
          options={optionsForToggle}
          bind:selectedOptionId={
            () => filterOn(cleanup, filter.key), (on) => onchange({ ...cleanup, [filter.key]: on })
          }
        />
      </SettingsItemGroup>
      {#if filter.key === 'repeatedChars' && cleanup.repeatedChars}
        <label class="hc-sub">
          <span>Repeat count <span class="hc-muted">(0 guesses it per line)</span></span>
          <input
            class="app-input hc-number"
            type="number"
            min="0"
            max="9"
            value={cleanup.repeatCount ?? 0}
            onchange={(event) =>
              onchange({ ...cleanup, repeatCount: Math.max(0, +event.currentTarget.value || 0) })}
          />
        </label>
      {:else if filter.key === 'recentLines' && cleanup.recentLines}
        <label class="hc-sub">
          <span>Lines remembered</span>
          <input
            class="app-input hc-number"
            type="number"
            min="1"
            max="200"
            value={cleanup.recentSize ?? defaultRecentSize}
            onchange={(event) =>
              onchange({
                ...cleanup,
                recentSize: Math.max(1, +event.currentTarget.value || defaultRecentSize)
              })}
          />
        </label>
      {:else if filter.key === 'replace' && cleanup.replace}
        <div class="hc-sub hc-rules">
          {#each rules as rule, index}
            <div class="hc-rule">
              <input
                class="app-input hc-field hc-pattern"
                aria-label="Pattern {index + 1}"
                aria-invalid={!!ruleError(rule.pattern)}
                placeholder="Pattern, e.g. ^【.+?】"
                spellcheck="false"
                autocomplete="off"
                value={rule.pattern}
                onchange={(event) => setRule(index, 'pattern', event.currentTarget.value)}
              />
              <input
                class="app-input hc-field"
                aria-label="Replacement {index + 1}"
                placeholder="Replacement"
                spellcheck="false"
                autocomplete="off"
                value={rule.replacement}
                onchange={(event) => setRule(index, 'replacement', event.currentTarget.value)}
              />
              <button
                class="app-button"
                onclick={() =>
                  onchange({ ...cleanup, rules: rules.filter((_, at) => at !== index) })}
              >
                Remove
              </button>
            </div>
            {#if ruleError(rule.pattern)}
              <p class="hc-error" role="alert">
                Rule {index + 1} is skipped: {ruleError(rule.pattern)}
              </p>
            {/if}
          {/each}
          <div class="hc-actions">
            <button
              class="app-button"
              onclick={() =>
                onchange({ ...cleanup, rules: [...rules, { pattern: '', replacement: '' }] })}
            >
              Add rule
            </button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .hc {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .hc-muted {
    margin: 0;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .hc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* The pattern on its own row, so both fields keep their placeholders in a narrow sheet. */
  .hc-rule {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
  }

  .hc-pattern {
    grid-column: 1 / -1;
  }

  .hc-field {
    min-width: 0;
    flex: 1;
    font-family: ui-monospace, monospace;
  }

  .hc-error {
    margin: 0;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .hc-preview {
    width: 100%;
    border-collapse: collapse;
    border-top: 2px solid var(--font-color);
  }

  .hc-preview th,
  .hc-preview td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    vertical-align: baseline;
  }

  .hc-preview th {
    width: 6rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .hc-preview td {
    font-size: var(--type-body);
    overflow-wrap: anywhere;
  }

  .hc-suggestion {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 2px;
    background: var(--app-spot-tint);
  }

  .hc-suggestion p {
    margin: 0;
  }

  .hc-suggestion strong {
    margin-right: 0.5rem;
    color: var(--accent-strong-color);
  }

  .hc-sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0 0.75rem 1rem;
    font-size: var(--type-small);
  }

  .hc-rules {
    flex-direction: column;
    align-items: stretch;
  }

  .hc-number {
    width: 5rem;
    font-variant-numeric: tabular-nums;
  }
</style>
