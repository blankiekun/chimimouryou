<script lang="ts">
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import TitleCard from '$lib/components/social/title-card.svelte';
  import { hubImageUrl } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';

  /**
   * A friend's book: your own cover when you have it (by book key: this browser, then the
   * server's catalog), else the hub's thumbnail, "Reading something" for a hidden one, else a
   * title card in the friend's avatar colour.
   */
  export let book: { key: string; title: string; kind: string; cover?: string | null };
  export let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined;
  export let avatar = 0;
  export let small = false;

  let failed = false;

  $: mine = book.kind === 'hidden' ? undefined : covers?.get(book.key);
  $: thumbnail = book.kind !== 'hidden' && book.cover ? hubImageUrl(`cover/${book.cover}`) : '';
</script>

{#if mine}
  <BookCard imagePath={mine.imagePath} title={mine.title} />
{:else if thumbnail && !failed}
  <span class="friend-cover-thumb"
    ><img
      src={thumbnail}
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      on:error={() => (failed = true)}
    /></span
  >
{:else if book.kind === 'hidden'}
  <TitleCard title={$t$('social.readingSomething')} muted {small} />
{:else}
  <TitleCard title={book.title} colour={(avatar % 8) + 1} {small} />
{/if}

<style>
  .friend-cover-thumb {
    display: block;
    width: 100%;
    aspect-ratio: 375 / 529;
    overflow: hidden;
    background: var(--surface-color);
  }

  .friend-cover-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
