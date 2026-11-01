<script lang="ts">
  import RankBadge from '$lib/components/reading-rank/rank-badge.svelte';
  import {
    rankSteps,
    rankTiers,
    stepNumeral,
    type ReadingRank,
    type Requirement
  } from '$lib/data/stats/reading-rank';
  import { loadReadingRank } from '$lib/data/stats/reading-rank-data';
  import { database, startDayHoursForTracker$ } from '$lib/data/store';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { onMount } from 'svelte';

  /**
   * The reading rank as one ruled row (Home's dashboard, Profile, Statistics): the badge with its
   * step, the next step's estimate, one short track per requirement (the nearest unmet one in the
   * rank's colour) and the light novels' worth. Opening it lists each requirement with its own
   * estimate, then every step grouped by rank. Not part of upstream.
   */

  /** Bumped by the host when the statistics were pulled again */
  export let refresh = 0;

  let rank: ReadingRank | undefined;

  const day = 24 * 60 * 60 * 1000;
  const number = (value: number) => value.toLocaleString('en-US');
  /** Short figures for the closed row's tracks: 1.38M, 810k, 9,850 */
  const short = (value: number) =>
    value >= 1_000_000
      ? `${Number((value / 1_000_000).toFixed(2))}M`
      : value >= 100_000
        ? `${Math.round(value / 1000)}k`
        : number(value);
  const trackKeys: Record<Requirement['key'], MessageKey> = {
    characters: 'rank.trackCharacters',
    words: 'rank.trackWords',
    days: 'rank.trackDays',
    books: 'rank.trackBooks'
  };
  const reqKeys: Record<Requirement['key'], MessageKey> = {
    characters: 'rank.reqCharacters',
    words: 'rank.reqWords',
    days: 'rank.reqDays',
    books: 'rank.reqBooks'
  };
  const stepName = (index: number) => {
    const { rank: tier, step } = rankSteps[index - 1];

    return `${rankTiers[tier - 1].ja} ${stepNumeral(step)}`.trim();
  };
  /** Share of the way from the step before's need */
  const share = ({ have, from, need, met }: Requirement) =>
    met ? 1 : Math.min(Math.max((have - from) / (need - from), 0), 1);

  async function load() {
    const statistics = await database
      .getStatisticsForTimeWindow('0000-00-00', '9999-99-99')
      .catch(() => []);

    rank = await loadReadingRank(statistics, getDateKey($startDayHoursForTracker$)).catch(
      () => rank
    );
  }

  onMount(load);
  $: if (refresh) load();

  $: next = rank?.next;
  $: nextName = next ? stepName(next.step) : '';
  $: missingBooks = next?.requirements.find((req) => req.key === 'books' && !req.met);
  // The unmet track with the largest share done; a tie goes to the sooner one.
  $: nearest = next?.requirements
    .filter((req) => !req.met)
    .sort((a, b) => share(b) - share(a) || (a.eta ?? Infinity) - (b.eta ?? Infinity))[0]?.key;
  $: date = (ms: number) =>
    new Date(ms).toLocaleDateString($uiLanguage$, { month: 'short', day: 'numeric' });
  $: duration = (ms: number) => {
    const days = Math.max(1, Math.round(ms / day));

    if (days < 14)
      return days === 1 ? $t$('rank.aboutDay') : $t$('rank.aboutDays', { count: days });

    const weeks = Math.round(days / 7);

    if (days < 60)
      return weeks === 1 ? $t$('rank.aboutWeek') : $t$('rank.aboutWeeks', { count: weeks });

    const months = Math.round(days / 30.4);

    return months === 1 ? $t$('rank.aboutMonth') : $t$('rank.aboutMonths', { count: months });
  };
  $: booksText = (req: Requirement, name: string) =>
    req.need - req.have === 1
      ? $t$('rank.moreBook', { rank: name, level: req.level!.toFixed(1) })
      : $t$('rank.moreBooks', {
          rank: name,
          count: req.need - req.have,
          level: req.level!.toFixed(1)
        });
  $: headline = !next
    ? $t$('rank.top')
    : next.risesAt
      ? $t$('rank.rises', { rank: nextName, date: date(next.risesAt) })
      : next.eta
        ? $t$('rank.inAbout', { rank: nextName, eta: duration(next.eta) })
        : next.eta === null
          ? $t$('rank.noEstimate', { rank: nextName })
          : missingBooks
            ? booksText(missingBooks, nextName)
            : nextName;
  $: requirementText = (req: Requirement) =>
    $t$(reqKeys[req.key], {
      have: number(req.have),
      need: number(req.need),
      level: req.level?.toFixed(1) ?? ''
    });
  $: requirementEta = (req: Requirement) =>
    req.met
      ? ''
      : req.key === 'books'
        ? req.need - req.have === 1
          ? $t$('rank.oneMoreBook')
          : $t$('rank.moreBooksShort', { count: req.need - req.have })
        : req.eta !== undefined
          ? $t$('rank.about', { eta: duration(req.eta) })
          : '';
</script>

{#if rank}
  <details class="rank" style:--rank="var(--rank-{rank.rank})">
    <summary aria-label={$t$('rank.label')}>
      <span class="rank-badge-cell"><RankBadge tier={rank.rank} step={rank.stepOfRank} /></span>
      <span class="rank-progress">
        <span class="rank-progress-text">{headline}</span>
        {#if next}
          <span class="rank-tracks">
            {#each next.requirements as req (req.key)}
              <span class="rank-track-cell" class:rank-track-near={req.key === nearest}>
                <span class="rank-track-head">
                  <span class="rank-track-label">{$t$(trackKeys[req.key])}</span>
                  <span class="rank-track-value">{short(req.have)} / {short(req.need)}</span>
                </span>
                {#if req.key === 'books'}
                  <span class="rank-segments" aria-hidden="true">
                    {#each Array(req.need) as _, i}
                      <span class:rank-segment-done={i < req.have}></span>
                    {/each}
                  </span>
                {:else}
                  <span class="rank-track" aria-hidden="true">
                    <span style:width="{share(req) * 100}%"></span>
                  </span>
                {/if}
              </span>
            {/each}
          </span>
        {/if}
      </span>
      <span class="rank-novels" title={$t$('rank.novelsHint')}>
        {$t$('rank.novels', { count: rank.novels.toFixed(1) })}
      </span>
    </summary>
    <div class="rank-sheet">
      {#if next}
        <p class="rank-sheet-head">
          {[
            $t$('rank.next', { rank: nextName }),
            next.eta ? $t$('rank.about', { eta: duration(next.eta) }) : ''
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <ul class="rank-reqs">
          {#each next.requirements as req (req.key)}
            <li class:rank-req-met={req.met} class:rank-track-near={req.key === nearest}>
              <span>{[requirementText(req), requirementEta(req)].filter(Boolean).join(' · ')}</span>
              {#if req.key === 'books'}
                <span class="rank-segments" aria-hidden="true">
                  {#each Array(req.need) as _, i}
                    <span class:rank-segment-done={i < req.have}></span>
                  {/each}
                </span>
              {:else}
                <span class="rank-track" aria-hidden="true">
                  <span style:width="{share(req) * 100}%"></span>
                </span>
              {/if}
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
              <th scope="col">{$t$('rank.colBooks')}</th>
            </tr>
          </thead>
          <tbody>
            {#each rankSteps as step, i (i)}
              <tr
                class:rank-group={step.step <= 1}
                aria-current={i + 1 === rank.step || undefined}
                style:--rank="var(--rank-{step.rank})"
              >
                <th scope="row">
                  {#if step.step <= 1}
                    <RankBadge tier={step.rank} step={step.step} small />
                  {:else}
                    <span class="rank-step-numeral"
                      ><span class="sr-only">{rankTiers[step.rank - 1].ja} </span>{stepNumeral(
                        step.step
                      )}</span
                    >
                  {/if}
                </th>
                <td>{number(step.characters)}</td>
                <td>{step.days}</td>
                <td>{number(step.words)}</td>
                <td>{step.level ? `${step.level.toFixed(1)}+` : '–'}</td>
                <td>{step.books || '–'}</td>
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
    padding: 0.5rem 0;
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

  .rank-badge-cell {
    flex: none;
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

  /* Four short tracks; they wrap to two rows, then one, as the row narrows (no figure collides). */
  .rank-tracks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
    gap: 0.4rem 1.25rem;
  }

  .rank-track-cell {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.2rem;
  }

  .rank-track-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 0.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .rank-track-label {
    font-weight: 700;
  }

  .rank-track-value {
    margin-left: auto;
  }

  .rank-track-near .rank-track-head,
  .rank-reqs .rank-track-near {
    color: var(--rank);
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
    background: var(--app-muted-fg);
  }

  .rank-segments {
    display: flex;
    height: 3px;
    gap: 3px;
  }

  .rank-segments > span {
    flex: 1;
    background: var(--border-color);
  }

  .rank-segments > .rank-segment-done {
    background: var(--app-muted-fg);
  }

  .rank-track-near .rank-track > span,
  .rank-track-near .rank-segments > .rank-segment-done {
    background: var(--rank);
  }

  .rank-novels {
    flex: none;
    color: var(--font-color);
    font-size: var(--type-small);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .rank-sheet {
    display: grid;
    gap: 1rem;
    padding: 0.5rem 0 1rem;
    font-size: var(--type-small);
  }

  .rank-sheet-head {
    font-weight: 700;
  }

  .rank-reqs {
    display: grid;
    max-width: 36rem;
    gap: 0.75rem;
  }

  .rank-reqs li {
    display: grid;
    gap: 0.3rem;
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .rank-reqs .rank-req-met {
    color: var(--font-color);
  }

  .rank-table-wrap {
    overflow-x: auto;
  }

  .rank-table caption {
    padding-bottom: 0.35rem;
    font-weight: 700;
    text-align: left;
  }

  .rank-table td,
  .rank-table thead th:not(:first-child) {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .rank-table tr.rank-group:not(:first-child) {
    border-top: 1px solid var(--app-muted-fg);
  }

  .rank-step-numeral {
    padding-left: 0.75rem;
    color: var(--rank);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .rank-table tr[aria-current] td {
    color: var(--font-color);
    font-weight: 700;
  }

  .rank-rules {
    max-width: 65ch;
    color: var(--app-muted-fg);
  }

  @media (max-width: 479px) {
    .rank summary {
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
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
