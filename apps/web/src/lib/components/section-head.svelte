<script lang="ts">
  /** Study Book section head: a numbered tag, the title, an optional count and a rule to the right. */
  export let number: number;
  export let title: string;
  export let count: number | string | undefined = undefined;
  export let level: 'h2' | 'h3' = 'h2';

  $: tag = String(number).padStart(2, '0');
</script>

<div class="section-head">
  <span class="section-head-number" aria-hidden="true">{tag}</span>
  <svelte:element this={level} class="section-head-title">{title}</svelte:element>
  {#if count !== undefined}
    <span class="section-head-count">{count}</span>
  {/if}
  <span class="section-head-rule" aria-hidden="true" />
</div>

<style>
  .section-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .section-head-number {
    display: inline-flex;
    flex: none;
    min-width: 1.75rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    padding: 0 0.3rem;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .section-head-title {
    min-width: 0;
    overflow: hidden;
    color: var(--font-color);
    font-size: var(--type-h2);
    font-weight: 400;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-head-count {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .section-head-rule {
    flex: 1 1 2rem;
    border-top: 1px solid var(--border-color);
  }
</style>
