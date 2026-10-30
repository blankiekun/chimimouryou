<script lang="ts">
  import DiscordVariablePicker from './discord-variable-picker.svelte';
  import {
    checkField,
    discordLimits,
    isVariable,
    suggestVariable,
    type DiscordValues,
    type VariableName
  } from '$lib/data/discord/discord-template';
  import { t$ } from '$lib/i18n';

  /**
   * A template input: {known} variables in the spot colour and {unknown} ones in danger (a
   * mirror under a transparent input), Insert variable, the filled-in length and its problems.
   */
  let {
    id,
    label,
    value = $bindable(),
    values,
    link = false,
    small = false,
    hint = '',
    placeholder = ''
  }: {
    id: string;
    label: string;
    value: string;
    values: DiscordValues;
    link?: boolean;
    /** A sub-label (Link, Hover text) */
    small?: boolean;
    hint?: string;
    placeholder?: string;
  } = $props();

  let input = $state<HTMLInputElement>();
  let mirror = $state<HTMLDivElement>();
  let picking = $state(false);

  const check = $derived(checkField(value, values, { link }));
  const max = $derived(link ? discordLimits.url : discordLimits.text);
  const parts = $derived(
    value.split(/(\{\w+\})/).map((text) => ({
      text,
      kind: /^\{\w+\}$/.test(text) ? (isVariable(text.slice(1, -1)) ? 'known' : 'unknown') : ''
    }))
  );
  const problem = $derived.by(() => {
    if (check.unknown.length) {
      const [name] = check.unknown;
      const suggestion = suggestVariable(name);

      return [
        $t$('discord.unknownVariable', { name: `{${name}}` }),
        suggestion ? $t$('discord.didYouMean', { name: `{${suggestion}}` }) : ''
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (check.badLink) return $t$('discord.httpsOnly');
    if (check.over) return $t$('discord.tooLong', { count: check.over });
    return '';
  });

  function sync() {
    if (mirror && input) mirror.scrollLeft = input.scrollLeft;
  }

  function insert(name: VariableName) {
    const text = `{${name}}`;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;

    value = value.slice(0, start) + text + value.slice(end);
    picking = false;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
      sync();
    });
  }
</script>

<div class="tf" class:tf-small={small}>
  <div class="tf-head">
    <label for={id}>{label}</label>
    <button
      type="button"
      class="tf-insert"
      class:tf-insert-open={picking}
      aria-expanded={picking}
      onclick={() => (picking = !picking)}
    >
      <span aria-hidden="true">{'{ }'}</span>
      {$t$('discord.insertVariable')}
    </button>
  </div>
  <div class="tf-box" class:tf-box-error={!!problem && !check.over}>
    <div class="tf-mirror" aria-hidden="true" bind:this={mirror}>
      {#each parts as part, i (i)}<span
          class:tf-known={part.kind === 'known'}
          class:tf-unknown={part.kind === 'unknown'}>{part.text}</span
        >{/each}<span class="tf-end"> </span>
    </div>
    <input
      {id}
      class="tf-input"
      autocomplete="off"
      spellcheck="false"
      {placeholder}
      aria-invalid={!!problem && !check.over}
      aria-describedby="{id}-meta"
      bind:this={input}
      bind:value
      oninput={sync}
      onscroll={sync}
      onkeyup={sync}
      onclick={sync}
      onselect={sync}
    />
  </div>
  {#if picking}
    <DiscordVariablePicker {values} onpick={insert} onclose={() => (picking = false)} />
  {/if}
  <div class="tf-meta" id="{id}-meta">
    <span class:tf-problem={!!problem}>{problem || hint}</span>
    {#if !link}
      <span class="tf-count" class:tf-problem={check.over > 0}>{check.length} / {max}</span>
    {/if}
  </div>
</div>

<style>
  .tf {
    display: grid;
    gap: 0.4rem;
    padding: 1rem 0 0.5rem;
  }

  .tf-small {
    padding-top: 0.25rem;
  }

  .tf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .tf-head label {
    font-size: var(--type-body);
  }

  .tf-small .tf-head label {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .tf-insert {
    display: inline-flex;
    min-height: 1.75rem;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.4rem;
    border-radius: 2px;
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .tf-insert:hover,
  .tf-insert-open {
    background: var(--app-spot-tint);
  }

  .tf-box {
    position: relative;
    min-height: var(--app-control-height);
    border: 1px solid var(--app-control-border);
    border-radius: 2px;
    background: var(--app-control-bg);
  }

  .tf-box:focus-within {
    border-color: var(--app-focus-ring);
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .tf-box-error,
  .tf-box-error:focus-within {
    border-color: var(--app-danger-color);
  }

  .tf-mirror,
  .tf-input {
    padding: 0 0.65rem;
    font: inherit;
    font-size: var(--type-body);
    letter-spacing: normal;
    line-height: calc(var(--app-control-height) - 2px);
    white-space: pre;
  }

  .tf-mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--font-color);
    pointer-events: none;
  }

  .tf-known {
    color: var(--accent-strong-color);
  }

  .tf-unknown {
    color: var(--app-danger-color);
  }

  .tf-input {
    position: relative;
    width: 100%;
    height: calc(var(--app-control-height) - 2px);
    border: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--font-color);
    outline: none;
  }

  .tf-input::placeholder {
    color: var(--app-text-subtle);
  }

  .tf-input::selection {
    background: color-mix(in srgb, var(--accent-color) 30%, transparent);
  }

  .tf-meta {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    line-height: 1.5;
  }

  .tf-count {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .tf-problem {
    color: var(--app-danger-color);
  }
</style>
