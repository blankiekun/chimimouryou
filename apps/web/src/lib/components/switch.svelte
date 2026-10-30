<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { t$ } from '$lib/i18n';

  /**
   * The app's on/off switch (`.app-switch` in app.scss). The text beside the knob is `children`
   * when given, else On/Off unless `stateText` is false. Other attributes (aria-label,
   * aria-labelledby, id, disabled) go on the button. Not part of upstream.
   */
  interface Props extends Omit<HTMLButtonAttributes, 'onchange' | 'children'> {
    checked: boolean;
    /** Called with the new value on click */
    onchange?: (next: boolean) => void;
    stateText?: boolean;
    children?: Snippet;
  }

  let { checked, onchange, stateText = true, children, ...rest }: Props = $props();
</script>

<button
  {...rest}
  type="button"
  role="switch"
  class="app-switch"
  aria-checked={checked}
  onclick={() => onchange?.(!checked)}
>
  <span class="app-switch-thumb"></span>
  {#if children}
    <span class="app-switch-text">{@render children()}</span>
  {:else if stateText}
    <span class="app-switch-text">{$t$(checked ? 'settings.on' : 'settings.off')}</span>
  {/if}
</button>
