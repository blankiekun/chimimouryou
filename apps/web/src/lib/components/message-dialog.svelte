<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { buttonClasses } from '$lib/css-classes';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';

  export let title: string;

  export let message: string;

  /** The way to fix what the message says, beside Close. */
  export let link: { href: string; text: string } | undefined = undefined;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{title}</svelte:fragment>
  <svelte:fragment slot="content">
    <p>{message}</p>
  </svelte:fragment>
  <svelte:fragment slot="footer">
    {#if link}
      <a class={buttonClasses} href={link.href} on:click={() => dispatch('close')}>{link.text}</a>
    {/if}
    <button class={buttonClasses} on:click={() => dispatch('close')}>
      Close
      <Ripple />
    </button>
  </svelte:fragment>
</DialogTemplate>
