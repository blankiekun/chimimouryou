<script lang="ts">
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import TitleCard from '$lib/components/social/title-card.svelte';
  import { t$ } from '$lib/i18n';

  /**
   * A friend's book: your own cover when you have it (by book key), "Reading something" for a
   * hidden one, else a title card in the friend's avatar colour.
   */
  export let book: { key: string; title: string; kind: string };
  export let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined;
  export let avatar = 0;
  export let small = false;

  $: mine = book.kind === 'hidden' ? undefined : covers?.get(book.key);
</script>

{#if mine}
  <BookCard imagePath={mine.imagePath} title={mine.title} />
{:else if book.kind === 'hidden'}
  <TitleCard title={$t$('social.readingSomething')} muted {small} />
{:else}
  <TitleCard title={book.title} colour={(avatar % 8) + 1} {small} />
{/if}
