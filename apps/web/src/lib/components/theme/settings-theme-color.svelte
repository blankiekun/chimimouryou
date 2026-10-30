<script lang="ts">
  import { faRotateLeft } from '@fortawesome/free-solid-svg-icons';
  import { fromHexAndAlpha, parseCssColor, toHex } from '$lib/data/theme/color-utils';
  import { isValidColor } from '$lib/data/theme/themes';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  export let label: string;
  export let description: string;
  export let cssVar: string;
  /** Value set by this theme, undefined when inherited */
  export let value: string | undefined;
  /** Value it would have without the override */
  export let inherited: string;

  const dispatch = createEventDispatcher<{ change: string | undefined }>();

  let text = value ?? '';

  $: effective = value ?? inherited;
  $: parsed = parseCssColor(effective);
  $: hex = parsed ? toHex(parsed) : '#000000';
  $: alpha = parsed?.a ?? 1;
  $: text = value ?? '';
  $: invalid = !!text && !isValidColor(text);

  function setFromPicker(newHex: string, newAlpha: number) {
    dispatch('change', fromHexAndAlpha(newHex, newAlpha));
  }
</script>

<div class="theme-color-row" title="{description} ({cssVar})">
  <span class="theme-color-preview" style:--preview={effective}>
    <input
      type="color"
      value={hex}
      aria-label="{label} colour"
      on:input={(event) => setFromPicker(event.currentTarget.value, alpha)}
    />
  </span>
  <span class="theme-color-label">{label}</span>
  <input
    class="app-input theme-color-text"
    class:theme-color-invalid={invalid}
    type="text"
    spellcheck="false"
    aria-label="{label} value"
    placeholder={inherited}
    value={text}
    on:change={(event) => {
      const next = event.currentTarget.value.trim();

      if (!next) {
        dispatch('change', undefined);
      } else if (isValidColor(next)) {
        dispatch('change', next);
      }
    }}
  />
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    value={alpha}
    aria-label="{label} opacity"
    title="Opacity {Math.round(alpha * 100)}%"
    on:input={(event) => setFromPicker(hex, Number(event.currentTarget.value))}
  />
  <button
    type="button"
    class="theme-color-reset"
    title="Use the inherited colour"
    aria-label="Use the inherited colour for {label}"
    disabled={value === undefined}
    on:click={() => dispatch('change', undefined)}
  >
    <Fa icon={faRotateLeft} />
  </button>
</div>

<style>
  .theme-color-row {
    display: grid;
    grid-template-columns: 1.75rem minmax(0, 1fr) 7.5rem minmax(0, 7rem) 2rem;
    align-items: center;
    gap: 0.75rem;
    padding: 0.3rem 0 0.3rem 1rem;
  }

  @media (max-width: 640px) {
    .theme-color-row {
      grid-template-columns: 1.75rem minmax(0, 1fr) 6.5rem 2rem;
      padding-left: 0;
    }

    .theme-color-row input[type='range'] {
      display: none;
    }
  }

  .theme-color-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .theme-color-preview {
    position: relative;
    width: 1.75rem;
    height: 1.75rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background:
      linear-gradient(var(--preview), var(--preview)),
      repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 50% / 10px 10px;
  }

  .theme-color-preview input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .theme-color-text {
    width: 100%;
    min-height: 2rem;
    padding: 0.2rem 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: var(--type-label);
  }

  .theme-color-row input[type='range'] {
    accent-color: var(--accent-color);
  }

  .theme-color-reset {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    align-items: center;
    justify-content: center;
    color: var(--app-muted-fg);
  }

  .theme-color-reset:disabled {
    opacity: 0.3;
  }

  .theme-color-invalid {
    border-color: var(--app-danger-color);
  }
</style>
