<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { addToHome, homeBookTitles$ } from '$lib/data/library/library-home';
  import { t$ } from '$lib/i18n';

  /**
   * Store → one series (routes/manage): its name, author and counts, and Add all to Home.
   */

  interface Props {
    series: string;
    /** The series' books in reading order (not empty) */
    cards: BookCardProps[];
  }

  let { series, cards }: Props = $props();

  const missing = $derived(cards.filter((card) => !$homeBookTitles$.includes(card.title)));
</script>

<div class="series-header">
  <div class="min-w-0">
    <h1 class="series-header-title" lang="ja">{series}</h1>
    <p class="series-header-meta" lang="ja">
      {[
        cards[0].authors !== 'Unknown' ? cards[0].authors : '',
        $t$('store.seriesMeta', {
          count: cards.length,
          started: cards.filter((card) => card.progress > 0).length,
          missing: missing.length
        })
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  </div>
  <button
    type="button"
    class="app-button app-button-primary"
    disabled={!missing.length}
    onclick={() => addToHome(missing.map((card) => card.title))}
  >
    {missing.length ? $t$('store.addAll', { count: missing.length }) : $t$('store.allOnHome')}
  </button>
</div>

<style>
  .series-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 2rem;
    margin-bottom: 1.5rem;
  }

  .series-header-title {
    font-size: var(--type-h1);
    font-weight: 700;
    line-height: 1.3;
  }

  .series-header-meta {
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
