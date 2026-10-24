<script lang="ts">
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import RankBadge from '$lib/components/reading-rank/rank-badge.svelte';
  import { rankTiers, type ReadingRank, type Requirement } from '$lib/data/reading-rank';
  import { loadReadingRank } from '$lib/data/reading-rank-data';
  import { database } from '$lib/data/store';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  /**
   * The reading rank as one ruled row (Home's dashboard, Statistics): the badge, the next rank's
   * requirements met on a 3px track, and the light novels' worth. Opening it lists the next
   * rank's requirements and every rank. Not part of upstream.
   */

  /** Bumped by the host when the statistics were pulled again */
  export let refresh = 0;

  let rank: ReadingRank | undefined;

  const number = (value: number) => value.toLocaleString('en-US');
  const reqKeys: Record<Requirement['key'], MessageKey> = {
    words: 'rank.reqWords',
    characters: 'rank.reqCharacters',
    days: 'rank.reqDays',
    book: 'rank.reqBook'
  };

  async function load() {
    const statistics = await database
      .getStatisticsForTimeWindow('0000-00-00', '9999-99-99')
      .catch(() => []);

    rank = await loadReadingRank(statistics).catch(() => rank);
  }

  onMount(load);
  $: if (refresh) load();

  $: next = rank?.next;
  $: met = next ? next.requirements.filter((req) => req.met).length : 0;
  $: nextName = next ? rankTiers[next.tier - 1].ja : '';
  $: date = (ms: number) =>
    new Date(ms).toLocaleDateString($uiLanguage$, { month: 'short', day: 'numeric' });
  $: requirementText = (req: Requirement) =>
    req.key === 'book'
      ? $t$(reqKeys.book, { need: req.need.toFixed(1) })
      : $t$(reqKeys[req.key], { have: number(req.have), need: number(req.need) });
</script>

{#if rank}
  <details class="rank" style:--rank="var(--rank-{rank.tier})">
    <summary aria-label={$t$('rank.label')}>
      <RankBadge tier={rank.tier} />
      <span class="rank-progress">
        <span class="rank-progress-text">
          {#if next?.risesAt}
            {$t$('rank.rises', { rank: nextName, date: date(next.risesAt) })}
          {:else if next}
            {$t$('rank.progress', { met, total: next.requirements.length, rank: nextName })}
          {:else}
            {$t$('rank.top')}
          {/if}
        </span>
        <span class="rank-track" aria-hidden="true">
          <span style:width="{next ? (met / next.requirements.length) * 100 : 100}%" />
        </span>
      </span>
      <span class="rank-novels" title={$t$('rank.novelsHint')}>
        {$t$('rank.novels', { count: rank.novels.toFixed(1) })}
      </span>
    </summary>
    <div class="rank-sheet">
      {#if next}
        <p class="rank-sheet-head">{$t$('rank.next', { rank: nextName })}</p>
        <ul class="rank-reqs">
          {#each next.requirements as req (req.key)}
            <li class:rank-req-met={req.met}>
              <span class="rank-req-mark" aria-hidden="true"
                >{#if req.met}<Fa icon={faCheck} />{/if}</span
              >
              {requirementText(req)}
            </li>
          {/each}
        </ul>
      {/if}
      <div class="rank-table-wrap">
        <table class="app-table rank-table">
          <caption>{$t$('rank.all')}</caption>
          <thead>
            <tr>
              <th scope="col">{$t$('rank.colRank')}</th>
              <th scope="col">{$t$('rank.colCharacters')}</th>
              <th scope="col">{$t$('rank.colDays')}</th>
              <th scope="col">{$t$('rank.colWords')}</th>
              <th scope="col">{$t$('rank.colBook')}</th>
            </tr>
          </thead>
          <tbody>
            {#each rankTiers as tier, i (tier.ja)}
              <tr aria-current={i + 1 === rank.tier || undefined}>
                <th scope="row"><RankBadge tier={i + 1} small /></th>
                <td>{number(tier.characters)}</td>
                <td>{tier.days}</td>
                <td>{number(tier.words)}</td>
                <td>{tier.difficulty ? `${tier.difficulty.toFixed(1)}+` : '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="rank-rules">{$t$('rank.rules')}</p>
    </div>
  </details>
{/if}

<style>
  .rank {
    border-top: 2px solid var(--font-color);
    border-bottom: 1px solid var(--border-color);
  }

  .rank summary {
    display: flex;
    min-height: 3.25rem;
    align-items: center;
    gap: 1rem;
    cursor: pointer;
    list-style: none;
  }

  .rank summary::-webkit-details-marker {
    display: none;
  }

  .rank summary:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .rank-progress {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 0.35rem;
  }

  .rank-progress-text {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .rank-track {
    position: relative;
    display: block;
    height: 3px;
    background: var(--border-color);
  }

  .rank-track > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--rank);
  }

  .rank-novels {
    color: var(--font-color);
    font-size: var(--type-small);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .rank-sheet {
    display: grid;
    gap: 0.75rem;
    padding: 0.5rem 0 1rem;
    font-size: var(--type-small);
  }

  .rank-sheet-head {
    font-weight: 700;
  }

  .rank-reqs li {
    display: flex;
    gap: 0.5rem;
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .rank-reqs .rank-req-met {
    color: var(--font-color);
  }

  .rank-req-mark {
    width: 1em;
    color: var(--accent-strong-color);
  }

  .rank-table-wrap {
    overflow-x: auto;
  }

  .rank-table caption {
    padding-bottom: 0.35rem;
    font-weight: 700;
    text-align: left;
  }

  .rank-table td {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .rank-table tr[aria-current] td {
    color: var(--font-color);
    font-weight: 700;
  }

  .rank-rules {
    color: var(--app-muted-fg);
  }

  @media (max-width: 479px) {
    .rank summary {
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      padding: 0.5rem 0;
    }

    .rank-progress {
      order: 3;
      flex-basis: 100%;
    }

    .rank-novels {
      margin-left: auto;
    }
  }
</style>
