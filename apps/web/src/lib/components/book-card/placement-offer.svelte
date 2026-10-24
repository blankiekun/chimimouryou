<script lang="ts">
  import { ankiKnownWords$ } from '$lib/data/anki';
  import { pagePath } from '$lib/data/env';
  import { placementCutoff$, placementFromWordTest$, placementOffered$ } from '$lib/data/placement';
  import { getWordsSummary } from '$lib/data/words-met';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  /**
   * Home's one-time offer of the placement check, for a reader with no known words: nothing
   * met, marked or read from Anki, and no placement result. Dismissed for good either way.
   * After the public word test (same origin), it says the result carried over instead.
   */

  let empty = false;

  $: fromTest = $placementFromWordTest$ && $placementCutoff$ > 0 && !$placementOffered$;

  onMount(() => {
    if ($placementOffered$ || $placementCutoff$ > 0 || $ankiKnownWords$) return;
    getWordsSummary().then(
      (summary) => (empty = !summary.met && !summary.known),
      () => {}
    );
  });
</script>

{#if fromTest}
  <section class="placement-offer" aria-label={$t$('words.placement')}>
    <div>
      <h2 class="placement-offer-title">
        {$t$('placement.fromWordTest', { count: $placementCutoff$.toLocaleString('en-US') })}
      </h2>
      <p class="placement-offer-text">
        {$t$('placement.fromWordTestText', { count: $placementCutoff$.toLocaleString('en-US') })}
      </p>
    </div>
    <span class="placement-offer-actions">
      <button
        type="button"
        class="app-button app-button-primary"
        on:click={() => ($placementOffered$ = true)}>{$t$('placement.ok')}</button
      >
      <a
        class="app-button app-button-quiet"
        href="{pagePath}/placement"
        on:click={() => ($placementOffered$ = true)}>{$t$('words.placementRetake')}</a
      >
    </span>
  </section>
{:else if empty && !$placementOffered$ && !($placementCutoff$ > 0)}
  <section class="placement-offer" aria-label={$t$('placement.offerTitle')}>
    <div>
      <h2 class="placement-offer-title">{$t$('placement.offerTitle')}</h2>
      <p class="placement-offer-text">{$t$('placement.offerText')}</p>
    </div>
    <span class="placement-offer-actions">
      <a
        class="app-button app-button-primary"
        href="{pagePath}/placement"
        on:click={() => ($placementOffered$ = true)}>{$t$('words.placementTake')}</a
      >
      <button
        type="button"
        class="app-button app-button-quiet"
        on:click={() => ($placementOffered$ = true)}>{$t$('placement.notNow')}</button
      >
    </span>
  </section>
{/if}

<style>
  .placement-offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem 2rem;
    padding: 1rem 0;
    border-top: 2px solid var(--accent-color);
    border-bottom: 1px solid var(--border-color);
  }

  .placement-offer-title {
    font-size: var(--type-h2);
    line-height: 1.3;
  }

  .placement-offer-text {
    max-width: 40rem;
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.7;
  }

  .placement-offer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
