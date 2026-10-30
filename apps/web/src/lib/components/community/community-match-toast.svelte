<script lang="ts">
  import Toast from '$lib/components/toast.svelte';
  import { answerMatch, type MatchOffer } from '$lib/data/social/community-book';
  import { t$ } from '$lib/i18n';

  /**
   * On book open, an unmatched book the hub has a suggestion for (markBookOnOpen): "Other readers
   * matched this book to <work>". Match confirms it and the lines get their bubbles; Not now or
   * close never ask again for the title; Choose another opens the Community tab's match sheet.
   */
  interface Props {
    offer: MatchOffer;
    onchoose: () => void;
  }

  let { offer, onchoose }: Props = $props();

  let busy = $state(false);

  async function match() {
    busy = true;
    await answerMatch(offer, true).catch(() => {});
  }
</script>

<Toast label={$t$('community.toastLabel')} onclose={() => answerMatch(offer, false)}>
  <p class="lead">{$t$('community.toastLead')}</p>
  <div class="work">
    {#if offer.cover}<img src={offer.cover} alt="" referrerpolicy="no-referrer" />{/if}
    <div>
      <p class="name" lang="ja">{offer.name}</p>
      {#if offer.vol}<p class="vol">{$t$('community.vol', { vol: offer.vol })}</p>{/if}
    </div>
  </div>
  <p class="lead">{$t$('community.toastHint')}</p>
  <div class="actions">
    <button type="button" class="app-button app-button-primary" disabled={busy} onclick={match}
      >{$t$('community.toastMatch')}</button
    >
    <button
      type="button"
      class="app-button"
      disabled={busy}
      onclick={() => answerMatch(offer, false)}>{$t$('community.toastNotNow')}</button
    >
    <button
      type="button"
      class="app-button-quiet"
      disabled={busy}
      onclick={() => {
        answerMatch(offer, false);
        onchoose();
      }}>{$t$('community.toastOther')}</button
    >
  </div>
</Toast>

<style>
  .lead {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
  }

  .work {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0;
  }

  .work img {
    width: 2.5rem;
    flex: none;
    aspect-ratio: 375 / 529;
    object-fit: cover;
  }

  .name {
    font-weight: 700;
  }

  .vol {
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-top: 0.75rem;
  }
</style>
