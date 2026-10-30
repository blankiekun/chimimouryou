<script lang="ts">
  import type { AiConnectionTest } from '$lib/data/ai-connections';
  import { testTone, whenTested } from './ai-format';

  export let test: AiConnectionTest;
  /** Testing…: no result yet */
  export let pending = false;
  /** One line with the time ("Works · today 14:02"), for the table */
  export let compact = false;

  $: tone = pending ? 'muted' : testTone(test);
</script>

<span class="result" class:compact role="status">
  <span class="dot dot-{tone}" aria-hidden="true" />
  <span>
    <span class="title">{test.title}{compact && test.at ? ` · ${whenTested(test.at)}` : ''}</span>
    {#if !compact && test.detail}
      <span class="detail">{test.detail}</span>
    {/if}
  </span>
</span>

<style>
  .result {
    display: inline-flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .compact .title {
    color: var(--app-muted-fg);
  }

  .detail {
    display: block;
    color: var(--app-muted-fg);
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    flex: none;
    border-radius: 50%;
    transform: translateY(-0.05rem);
  }

  .dot-ok {
    background: var(--accent-color);
  }

  .dot-warn {
    background: var(--app-warning-color);
  }

  .dot-error {
    background: var(--app-danger-color);
  }

  .dot-muted {
    background: var(--app-muted-fg);
  }
</style>
