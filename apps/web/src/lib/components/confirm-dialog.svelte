<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  export let dialogHeader: string;
  export let dialogMessage: string;
  export let contentStyles: string = '';
  export let showCancel = true;
  /** The action, named with its verb (and count), e.g. "Delete 3 titles" */
  export let confirmLabel = 'Confirm';
  export let cancelLabel = 'Cancel';
  /** Destructive: the action button is filled with the danger colour */
  export let danger = false;
  export let resolver: (arg0: boolean) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let cancelButton: HTMLButtonElement;

  onMount(() => cancelButton?.focus());

  function closeDialog(wasCanceled = false) {
    resolver(wasCanceled);
    dispatch('close');
  }
</script>

<svelte:window on:keydown={(ev) => ev.key === 'Escape' && showCancel && closeDialog(true)} />

<DialogTemplate>
  <svelte:fragment slot="header">{dialogHeader}</svelte:fragment>
  <svelte:fragment slot="content">
    <p class="confirm-message" style={contentStyles}>{dialogMessage}</p>
  </svelte:fragment>
  <svelte:fragment slot="footer">
    {#if showCancel}
      <button class="app-button" bind:this={cancelButton} on:click={() => closeDialog(true)}>
        {cancelLabel}
      </button>
    {/if}
    <button
      class="app-button {danger ? 'confirm-danger' : 'app-button-primary'}"
      on:click={() => closeDialog()}
    >
      {confirmLabel}
    </button>
  </svelte:fragment>
</DialogTemplate>

<style>
  .confirm-message {
    width: min(27rem, calc(80vw - 3rem));
    line-height: 1.6;
  }

  .confirm-danger,
  .confirm-danger:hover:not(:disabled) {
    border-color: var(--app-danger-color);
    background: var(--app-danger-color);
    color: var(--background-color);
  }
</style>
