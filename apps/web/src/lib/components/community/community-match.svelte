<script lang="ts">
  import { confirmWork, searchWorks, volumeOf } from '$lib/data/community';
  import { communityErrorKey, workTitles } from '$lib/data/community-book';
  import type { MetadataCandidate, MetadataKind } from '$lib/data/book-metadata';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * "Is this <title> Vol. N?" (board 6): the book is matched to its AniList or VNDB entry once,
   * so posts meet across editions. Yes keeps it, Pick another steps through the other matches,
   * Not listed keeps the book's own title. The hub's suggestion, when there is one, comes first.
   */
  export let title: string;
  export let kind: MetadataKind = 'book';
  export let suggestion: string | null = null;

  const dispatch = createEventDispatcher<{ done: string }>();

  let candidates: (MetadataCandidate & { work: string })[] = [];
  let shown = 0;
  let loading = true;
  let busy = false;
  let error = '';

  $: candidate = candidates[shown];
  $: volume = volumeOf(title);

  onMount(async () => {
    try {
      const found = await searchWorks(title, kind);

      candidates = [
        ...found.filter((item) => item.work === suggestion),
        ...found.filter((item) => item.work !== suggestion)
      ];
    } catch (_) {
      candidates = [];
    } finally {
      loading = false;
    }
  });

  async function choose(work: string | null, name = '') {
    busy = true;
    error = '';
    try {
      const chosen = await confirmWork(title, work);

      if (chosen && name) workTitles.set(chosen, name);
      if (chosen) dispatch('done', chosen);
      else error = $t$('community.error.other');
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      busy = false;
    }
  }
</script>

<section class="match" aria-labelledby="community-match-title">
  <h3 id="community-match-title" lang="ja">
    {$t$(volume ? 'community.matchTitleVol' : 'community.matchTitle', {
      title: candidate?.title || title,
      vol: volume
    })}
  </h3>
  <p class="match-lead">{$t$('community.matchLead')}</p>

  {#if loading}
    <p class="match-lead">{$t$('community.searching')}</p>
  {:else if candidate}
    <div class="match-card">
      {#if candidate.cover}<img src={candidate.cover} alt="" referrerpolicy="no-referrer" />{/if}
      <div>
        <p class="match-name" lang="ja">{candidate.title}</p>
        {#if candidate.released}<p class="match-meta">{candidate.released.slice(0, 4)}</p>{/if}
        {#if volume}<p class="match-vol">{$t$('community.vol', { vol: volume })}</p>{/if}
        <p class="match-meta">{candidate.source === 'vndb' ? 'VNDB' : 'AniList'}</p>
      </div>
    </div>
    <div class="match-actions">
      <button
        type="button"
        class="app-button app-button-primary"
        disabled={busy}
        on:click={() => choose(candidate.work, candidate.title)}>{$t$('community.matchYes')}</button
      >
      {#if candidates.length > 1}
        <button
          type="button"
          class="app-button"
          disabled={busy}
          on:click={() => (shown = (shown + 1) % candidates.length)}
          >{$t$('community.matchAnother')}</button
        >
      {/if}
    </div>
  {:else}
    <p class="match-lead">{$t$('community.matchNone')}</p>
  {/if}
  <p class="match-other">
    <button type="button" class="app-button-quiet" disabled={busy} on:click={() => choose(null)}
      >{$t$('community.matchNotListed')}</button
    >
    <span>{$t$('community.matchNotListedHint')}</span>
  </p>
  {#if error}<p class="match-error" role="alert">{error}</p>{/if}
</section>

<style>
  .match {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .match h3 {
    font-size: var(--type-h2);
    font-weight: 400;
  }

  .match-lead,
  .match-meta,
  .match-other span {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .match-card {
    display: flex;
    gap: 1rem;
    padding: 0.75rem;
    border: 1px solid var(--c-rule, var(--border-color));
    border-radius: 2px;
  }

  .match-card img {
    width: 4.5rem;
    flex: none;
    aspect-ratio: 375 / 529;
    object-fit: cover;
  }

  .match-name {
    font-size: var(--type-h2);
  }

  .match-vol {
    margin-top: 0.25rem;
    font-weight: 700;
  }

  .match-actions {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: 0.75rem;
  }

  .match-other {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .match-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
