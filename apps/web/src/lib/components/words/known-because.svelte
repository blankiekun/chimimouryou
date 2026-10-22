<script lang="ts">
  import { t$ } from '$lib/i18n';

  /** The Words pages' "Known because" table: one ruled row per reason a word counts as known. */
  export let rows: { label: string; value: number | undefined }[];
</script>

<dl class="known-because" aria-label={$t$('words.because')}>
  <div class="known-because-head">{$t$('words.because')}</div>
  {#each rows as row (row.label)}
    <div class="known-because-row">
      <dt>{row.label}</dt>
      <dd>{row.value === undefined ? '–' : row.value.toLocaleString('en-US')}</dd>
    </div>
  {/each}
</dl>

<style>
  .known-because {
    border-top: 2px solid var(--font-color);
  }

  .known-because-head {
    padding: 0.75rem 0 0.6rem;
    border-bottom: 1px solid var(--border-color);
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .known-because-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 11rem;
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  @media (max-width: 639px) {
    .known-because-row {
      grid-template-columns: minmax(0, 1fr) 5.5rem;
    }
  }

  .known-because-row dd {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
