<script lang="ts">
  /** An on/off switch for one Yomitan option (settings-dictionary-popup.svelte). */
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  export let checked: boolean;
  export let label: string;

  const dispatch = createEventDispatcher<{ change: boolean }>();
</script>

<button
  type="button"
  role="switch"
  class="app-switch"
  aria-checked={checked}
  aria-label={label}
  on:click={() => dispatch('change', !checked)}
>
  <span class="app-switch-thumb" />
  <span class="app-switch-text">{$t$(checked ? 'settings.on' : 'settings.off')}</span>
</button>
