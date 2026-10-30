<script lang="ts">
  import {
    variableGroups,
    type DiscordValues,
    type VariableGroup,
    type VariableName
  } from '$lib/data/discord/discord-template';
  import { t$ } from '$lib/i18n';

  /**
   * The {variable} picker: grouped Book / Progress / Today / You with their live values, a
   * filter, Esc to close. A popover under its field; a bottom sheet on phones.
   */
  let {
    values,
    onpick,
    onclose
  }: { values: DiscordValues; onpick: (name: VariableName) => void; onclose: () => void } =
    $props();

  const groupLabels = {
    book: 'discord.group.book',
    progress: 'discord.group.progress',
    today: 'discord.group.today',
    you: 'discord.group.you'
  } as const;

  let filter = $state('');
  let input = $state<HTMLInputElement>();

  const groups = $derived(
    (Object.keys(variableGroups) as VariableGroup[])
      .map((group) => ({
        group,
        names: variableGroups[group].filter((name) =>
          name.toLowerCase().includes(filter.trim().toLowerCase())
        )
      }))
      .filter((entry) => entry.names.length)
  );

  $effect(() => {
    input?.focus({ preventScroll: true });
  });

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker-layer" onkeydown={keydown}>
  <button
    type="button"
    class="picker-backdrop"
    aria-label={$t$('discord.closePicker')}
    tabindex="-1"
    onclick={onclose}
  ></button>
  <div class="picker" role="dialog" aria-label={$t$('discord.insertVariable')}>
    <div class="picker-head">
      <h4>{$t$('discord.insertVariable')}</h4>
      <span class="picker-esc">{$t$('discord.escToClose')}</span>
      <button type="button" class="app-button app-button-quiet picker-close" onclick={onclose}>
        {$t$('discord.close')}
      </button>
    </div>
    <input
      class="app-input picker-filter"
      placeholder={$t$('discord.filterVariables')}
      aria-label={$t$('discord.filterVariables')}
      bind:this={input}
      bind:value={filter}
    />
    <div class="picker-groups">
      {#each groups as { group, names } (group)}
        <section class="picker-group">
          <h5>{$t$(groupLabels[group])}</h5>
          <ul>
            {#each names as name (name)}
              <li>
                <button type="button" onclick={() => onpick(name)}>
                  <span class="picker-name">{`{${name}}`}</span>
                  <span class="picker-value">{values[name] || '—'}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <p class="picker-none">{$t$('discord.noVariables')}</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-layer {
    position: relative;
    z-index: 20;
  }

  .picker-backdrop {
    display: none;
  }

  .picker {
    margin-top: 0.25rem;
    padding: 1rem;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    background: var(--background-color);
  }

  .picker-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .picker-head h4 {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .picker-esc {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 400;
  }

  .picker-close {
    display: none;
  }

  .picker-filter {
    width: 100%;
    margin: 0.75rem 0;
  }

  .picker-groups {
    columns: 2 12rem;
    column-gap: 1.25rem;
  }

  .picker-group {
    margin-bottom: 1rem;
    break-inside: avoid;
  }

  .picker-group h5 {
    padding-bottom: 0.3rem;
    border-bottom: 2px solid var(--font-color);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .picker-group li {
    border-bottom: 1px solid var(--border-color);
  }

  .picker-group button {
    display: flex;
    width: 100%;
    min-height: 2.25rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0 0.4rem;
    text-align: left;
  }

  .picker-group button:hover,
  .picker-group button:focus-visible {
    background: var(--app-spot-tint);
  }

  .picker-name {
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .picker-value {
    min-width: 0;
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-none {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 400;
  }

  /* Phones: a bottom sheet over the page. */
  @media (max-width: 640px) {
    .picker-layer {
      position: fixed;
      inset: 0;
      z-index: 60;
    }

    .picker-backdrop {
      display: block;
      position: absolute;
      inset: 0;
      background: var(--app-overlay-color);
    }

    .picker {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      max-height: 70vh;
      overflow-y: auto;
      border: 0;
      border-top: 1px solid var(--border-color);
      padding-bottom: calc(1rem + env(safe-area-inset-bottom));
    }

    .picker-head h4 {
      font-size: var(--type-h2);
      font-weight: 400;
    }

    .picker-esc {
      display: none;
    }

    .picker-close {
      display: inline-flex;
    }

    .picker-groups {
      columns: 1;
    }
  }
</style>
