<script lang="ts">
  import { faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Switch from '$lib/components/switch.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import { builtInThemeIds } from '$lib/data/theme/themes';
  import { createEventDispatcher, getContext } from 'svelte';
  import Fa from 'svelte-fa';

  export let options: ToggleOption<any>[];
  export let selectedOptionId: any;
  export let invertColors = false;

  const dispatch = createEventDispatcher<{
    edit: string;
    delete: string;
  }>();
  /** Title of the settings row around it (settings-item-group.svelte), for screen readers */
  const label = getContext<string | undefined>('settings-item-label');

  /** Off/On pairs are a switch; anything else is a segmented control. */
  $: isSwitch =
    options.length === 2 && options[0].id === false && options[1].id === true && !$$slots.default;

  function mapToStyleString(style: Record<string, any> | undefined) {
    if (!style) return '';

    return Object.entries(style)
      .map(([key, value]) => `${key}: ${value}`)
      .join(';');
  }

  function onSegmentKeydown(event: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];

    if (!step) {
      return;
    }

    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    selectedOptionId = options[next].id;
    const group = (event.currentTarget as HTMLElement).parentElement?.parentElement;
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

{#if isSwitch}
  <Switch
    checked={!!selectedOptionId}
    aria-label={label}
    onchange={(next) => (selectedOptionId = next)}>{options[selectedOptionId ? 1 : 0].text}</Switch
  >
{:else}
  <div class="app-segmented" role="radiogroup" aria-label={label}>
    {#each options as option, index}
      <div class="flex">
        <button
          type="button"
          role="radio"
          aria-checked={option.id === selectedOptionId}
          tabindex={option.id === selectedOptionId ? 0 : -1}
          title={typeof option.id === 'string' ? option.id : undefined}
          class="app-segment"
          class:app-segment-selected={option.id === selectedOptionId}
          class:segment-thick={option.thickBorders}
          class:segment-inverted={invertColors}
          style={mapToStyleString(option.style)}
          on:click={() => (selectedOptionId = option.id)}
          on:keydown={(event) => onSegmentKeydown(event, index)}
        >
          {option.text}
        </button>
        {#if option.showIcons && option.id === selectedOptionId && !builtInThemeIds.has(option.id)}
          <div class="mx-1 flex flex-col justify-around">
            <button title="Edit" on:click={() => dispatch('edit', option.id)}>
              <Fa icon={faPen} />
            </button>
            <button title="Delete" on:click={() => dispatch('delete', option.id)}>
              <Fa icon={faTrash} />
            </button>
          </div>
        {/if}
      </div>
    {/each}

    <slot />
  </div>
{/if}

<style>
  /* .app-segmented and .app-segment are in app.scss. */

  /* Option previews (e.g. colours) keep their own look; selection shows as a ring. */
  .segment-thick.app-segment-selected {
    background: inherit;
    color: inherit;
    box-shadow: inset 0 0 0 2px var(--font-color);
  }

  .segment-inverted {
    background: var(--font-color);
    color: var(--background-color);
  }
</style>
