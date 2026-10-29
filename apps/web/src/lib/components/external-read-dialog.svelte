<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { hideExternalReadHint$ } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';

  export let resolver: (arg0: string) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  function closeDialog(result = '') {
    resolver(result);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">Read from external storage</svelte:fragment>
  <svelte:fragment slot="content">
    <p class="my-2">
      The whole book downloads again each time and may overwrite other sync targets. Export it to
      this browser to avoid that.
    </p>
    <p class="flex items-center mt-4">
      <input id="show-hint" type="checkbox" bind:checked={$hideExternalReadHint$} />
      <label class="ml-2" for="show-hint">Don't show again</label>
    </p>
  </svelte:fragment>
  <div class="flex flex-col sm:flex-row grow sm:justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => closeDialog('cancel')}>
      Cancel
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={() => closeDialog('export')}>
      Export
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={() => closeDialog()}>
      Open
      <Ripple />
    </button>
  </div>
</DialogTemplate>
