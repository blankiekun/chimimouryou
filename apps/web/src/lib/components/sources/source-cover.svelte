<script lang="ts">
  import { coverUrl } from '$lib/data/sources/server-sources';

  /**
   * A work's cover from the import service (covers/{id}, fetched once on the server), else the
   * paper title card. Web novels rarely have covers; Kakuyomu's published works do.
   */
  interface Props {
    title: string;
    /** The work's id when the server has a cover URL for it */
    workId?: number;
    size?: 'small' | 'large';
  }

  let { title, workId, size = 'small' }: Props = $props();
  let failed = $state(false);
</script>

<div class="source-cover source-cover-{size}" aria-hidden="true">
  {#if workId !== undefined && !failed}
    <img src={coverUrl(workId)} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else}
    <span lang="ja">{size === 'small' ? [...title].slice(0, 2).join('') : title}</span>
  {/if}
</div>

<style>
  /* One fixed size per place, like the shelves: the title on paper with a short ink rule. */
  .source-cover {
    flex: none;
    width: 3.25rem;
    height: 4.5rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--surface-color);
    color: var(--font-color);
    font-size: var(--type-small);
    font-weight: 700;
    line-height: 1.5;
  }

  .source-cover-large {
    width: 5.5rem;
    height: 8rem;
    font-weight: 400;
  }

  .source-cover span {
    display: -webkit-box;
    margin: 0.5rem;
    padding-bottom: 0.4rem;
    overflow: hidden;
    border-bottom: 2px solid var(--font-color);
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
  }

  .source-cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (min-width: 768px) {
    .source-cover-large {
      width: 7rem;
      height: 10rem;
    }
  }
</style>
