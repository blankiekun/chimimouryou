<script lang="ts">
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SectionHead from '$lib/components/section-head.svelte';
  import { ankiInvoke, ankiKnownDeck$, ankiKnownField$, ankiKnownWords$ } from '$lib/data/anki';
  import { pagePath } from '$lib/data/env';
  import { knownWords$, refreshKnownWords } from '$lib/data/known-words';
  import { t$ } from '$lib/i18n';

  /** The Words page's Anki section: the deck and field whose mature cards count as known. */

  let decks: string[] = [];
  let refreshing = false;
  let refreshError = '';

  $: toggle = [
    { id: false, text: $t$('settings.off') },
    { id: true, text: $t$('settings.on') }
  ] as ToggleOption<boolean>[];

  $: if ($ankiKnownWords$ && !decks.length) {
    ankiInvoke<string[]>('deckNames').then(
      (names) => (decks = names),
      () => {}
    );
  }

  function readTime(ms: number) {
    const time = new Date(ms);

    return time.toDateString() === new Date().toDateString()
      ? time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : time.toLocaleDateString('en-US');
  }

  async function refreshKnown() {
    refreshing = true;
    refreshError = '';
    try {
      await refreshKnownWords();
    } catch (error: any) {
      refreshError = error.message;
    } finally {
      refreshing = false;
    }
  }
</script>

<section class="anki" aria-label={$t$('words.anki')}>
  <SectionHead number={2} title={$t$('words.anki')} />

  <dl class="anki-table">
    <div title={$t$('anki.knownHint')}>
      <dt>{$t$('anki.known')}</dt>
      <dd><ButtonToggleGroup options={toggle} bind:selectedOptionId={$ankiKnownWords$} /></dd>
    </div>
    {#if $ankiKnownWords$}
      <div title={$t$('anki.deckHint')}>
        <dt><label for="anki-known-deck">{$t$('anki.deck')}</label></dt>
        <dd>
          <input
            id="anki-known-deck"
            autocomplete="off"
            class="app-input"
            list="anki-known-decks"
            bind:value={$ankiKnownDeck$}
          />
          <datalist id="anki-known-decks">
            {#each decks as deck}<option value={deck} />{/each}
          </datalist>
        </dd>
      </div>
      <div title={$t$('anki.wordFieldHint')}>
        <dt><label for="anki-known-field">{$t$('anki.wordField')}</label></dt>
        <dd>
          <input id="anki-known-field" class="app-input" bind:value={$ankiKnownField$} />
        </dd>
      </div>
      <div>
        <dt>{$t$('words.ankiRead')}</dt>
        <dd role="status">
          {#if refreshError}<span class="text-danger">{refreshError}</span
            >{:else if $knownWords$}{$t$('words.ankiReadValue', {
              date: readTime($knownWords$.read),
              count: $knownWords$.words.length.toLocaleString('en-US')
            })}{:else}{$t$('anki.notRead')}{/if}
        </dd>
      </div>
    {/if}
  </dl>

  <p class="anki-actions">
    {#if $ankiKnownWords$}
      <button type="button" class="app-button" disabled={refreshing} on:click={refreshKnown}>
        {refreshing ? $t$('anki.reading') : $t$('words.readNow')}
      </button>
    {/if}
    <a class="app-button app-button-quiet" href="{pagePath}/settings?section=anki">
      {$t$('words.ankiSettings')}
    </a>
  </p>
</section>

<style>
  .anki {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .anki-table {
    border-top: 2px solid var(--font-color);
  }

  .anki-table > div {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr);
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .anki-table dt {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .anki-table input {
    width: 100%;
  }

  .anki-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
  }
</style>
