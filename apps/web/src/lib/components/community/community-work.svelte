<script lang="ts">
  import TitleCard from '$lib/components/social/title-card.svelte';
  import { workCoverUrl } from '$lib/data/social/community';
  import { t$ } from '$lib/i18n';

  /** A work's cover thumbnail (the hub's, else a title card), title and volume */
  export let title: string;
  export let vol: string;
  export let cover: string | null;
  /** Extra meta after the volume */
  export let meta = '';

  let failed = false;

  $: src = cover && !failed ? workCoverUrl(cover) : '';
  $: colour = ([...title].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 8) + 1;
  $: line = [vol ? $t$('community.vol', { vol }) : '', meta].filter(Boolean).join(' · ');
</script>

<div class="work">
  <span class="work-cover">
    {#if src}
      <img
        {src}
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        on:error={() => (failed = true)}
      />
    {:else}
      <TitleCard title={title || '?'} {colour} small />
    {/if}
  </span>
  <span class="work-text">
    <span class="work-title" lang="ja">{title}</span>
    {#if line}<span class="work-meta">{line}</span>{/if}
  </span>
  <slot />
</div>

<style>
  .work {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
  }

  .work-cover {
    display: block;
    width: 2rem;
    flex: none;
  }

  .work-cover img {
    display: block;
    width: 100%;
    aspect-ratio: 375 / 529;
    object-fit: cover;
  }

  .work-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .work-title {
    overflow: hidden;
    font-size: var(--type-small);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .work-meta {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }
</style>
