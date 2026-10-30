<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import { pagePath } from '$lib/data/env';
  import {
    addImmersionEntry,
    deleteImmersionEntry,
    entriesBetween,
    getImmersionLog,
    immersionLog$,
    immersionTypes,
    totalsByType,
    type ImmersionSource
  } from '$lib/data/immersion-log';
  import { logger } from '$lib/data/logger';
  import { t$, type MessageKey } from '$lib/i18n';
  import { formatDuration } from '$lib/functions/format-time';
  import { onMount } from 'svelte';

  /**
   * Statistics → Immersion log: what was logged besides books in the selected days (the
   * texthooker, Listen and entries added here), with the books' reading time for comparison.
   */
  interface Props {
    number: number;
    start: string;
    end: string;
    todayKey: string;
    /** The books' reading in the same days */
    readingSeconds: number;
    readingCharacters: number;
  }

  let { number, start, end, todayKey, readingSeconds, readingCharacters }: Props = $props();

  const typeLabels: Record<string, MessageKey> = {
    vn: 'immersion.type.vn',
    anime: 'immersion.type.anime',
    podcast: 'immersion.type.podcast',
    listening: 'immersion.type.listening',
    other: 'immersion.type.other'
  };
  const sourceLabels: Record<ImmersionSource, MessageKey> = {
    manual: 'immersion.source.manual',
    hook: 'immersion.source.hook',
    listen: 'immersion.source.listen'
  };
  const custom = 'custom';

  let type = $state<string>('anime');
  let customType = $state('');
  let title = $state('');
  let day = $state('');
  let minutes = $state<number | null>(null);
  let characters = $state<number | null>(null);
  let adding = $state(false);

  const entries = $derived(entriesBetween($immersionLog$, start, end));
  const totals = $derived(totalsByType(entries));
  const loggedSeconds = $derived(totals.reduce((sum, total) => sum + total.seconds, 0));
  const entryType = $derived(type === custom ? customType.trim() : type);
  const canAdd = $derived(!!entryType && !!day && (minutes ?? 0) > 0);

  const typeLabel = (value: string) => (typeLabels[value] ? $t$(typeLabels[value]) : value);
  const count = (value: number) => value.toLocaleString('en-US');

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (!canAdd) return;
    await addImmersionEntry({
      type: entryType,
      title: title.trim(),
      day,
      seconds: Math.round((minutes ?? 0) * 60),
      characters: Math.max(0, Math.round(characters ?? 0))
    });
    title = '';
    minutes = null;
    characters = null;
    adding = false;
  }

  onMount(() => {
    day = todayKey;
    getImmersionLog().catch((error) =>
      logger.warn(`Couldn't read the immersion log: ${error.message}`)
    );
  });
</script>

<section class="immersion" aria-labelledby="immersion-log">
  <SectionHead {number} id="immersion-log" title={$t$('immersion.title')} count={entries.length} />

  <dl class="immersion-totals">
    <div>
      <dt>{$t$('immersion.books')}</dt>
      <dd>
        {formatDuration(readingSeconds, $t$)}
        <span class="immersion-chars">{count(readingCharacters)} {$t$('dashboard.unit')}</span>
      </dd>
    </div>
    {#each totals as total (total.type)}
      <div>
        <dt>{typeLabel(total.type)}</dt>
        <dd>
          {formatDuration(total.seconds, $t$)}
          {#if total.characters}
            <span class="immersion-chars">{count(total.characters)} {$t$('dashboard.unit')}</span>
          {/if}
        </dd>
      </div>
    {/each}
    <div class="immersion-sum">
      <dt>{$t$('immersion.total')}</dt>
      <dd>{formatDuration(readingSeconds + loggedSeconds, $t$)}</dd>
    </div>
  </dl>

  <div class="immersion-bar">
    <a class="app-button app-button-quiet" href="{pagePath}/hook">{$t$('immersion.openHook')}</a>
    <button type="button" class="app-button" onclick={() => (adding = !adding)}>
      {$t$('immersion.add')}
    </button>
  </div>

  {#if adding}
    <form class="immersion-form" onsubmit={add}>
      <label>
        <span>{$t$('immersion.type')}</span>
        <select class="app-input" bind:value={type}>
          {#each immersionTypes.filter((preset) => preset !== 'listening') as preset (preset)}
            <option value={preset}>{typeLabel(preset)}</option>
          {/each}
          <option value={custom}>{$t$('immersion.type.custom')}</option>
        </select>
      </label>
      {#if type === custom}
        <label>
          <span>{$t$('immersion.customType')}</span>
          <input class="app-input" bind:value={customType} maxlength="40" required />
        </label>
      {/if}
      <label>
        <span>{$t$('immersion.entryTitle')}</span>
        <input class="app-input" bind:value={title} maxlength="200" lang="ja" />
      </label>
      <label>
        <span>{$t$('immersion.date')}</span>
        <input class="app-input" type="date" bind:value={day} max={todayKey} required />
      </label>
      <label>
        <span>{$t$('immersion.minutes')}</span>
        <input class="app-input" type="number" min="1" step="1" bind:value={minutes} required />
      </label>
      <label>
        <span>{$t$('immersion.characters')}</span>
        <input class="app-input" type="number" min="0" step="1" bind:value={characters} />
      </label>
      <div class="immersion-form-actions">
        <button type="button" class="app-button app-button-quiet" onclick={() => (adding = false)}>
          {$t$('immersion.cancel')}
        </button>
        <button type="submit" class="app-button app-button-primary" disabled={!canAdd}>
          {$t$('immersion.save')}
        </button>
      </div>
    </form>
  {/if}

  {#if entries.length}
    <ul class="immersion-entries">
      {#each entries as entry (entry.id)}
        <li>
          <span class="immersion-day">{entry.day}</span>
          <span class="immersion-what">
            <strong>{entry.title || typeLabel(entry.type)}</strong>
            <span class="immersion-meta">
              {typeLabel(entry.type)} · {$t$(sourceLabels[entry.source])}
            </span>
          </span>
          <span class="immersion-figures">
            {formatDuration(entry.seconds, $t$)}
            {#if entry.characters}
              <span class="immersion-chars">{count(entry.characters)} {$t$('dashboard.unit')}</span>
            {/if}
          </span>
          <button
            type="button"
            class="app-button app-button-quiet"
            aria-label={$t$('immersion.delete')}
            title={$t$('immersion.delete')}
            onclick={() => deleteImmersionEntry(entry.id)}
          >
            ×
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="immersion-empty">{$t$('immersion.empty')}</p>
  {/if}
</section>

<style>
  .immersion {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1.25rem;
  }

  .immersion-totals {
    border-top: 2px solid var(--font-color);
  }

  .immersion-totals > div,
  .immersion-entries li {
    display: flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .immersion-totals dt {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .immersion-totals dd,
  .immersion-figures {
    font-size: var(--type-body);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .immersion-sum dt {
    color: var(--font-color);
    font-weight: 700;
  }

  .immersion-chars,
  .immersion-meta,
  .immersion-day,
  .immersion-empty {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .immersion-chars {
    margin-left: 0.5rem;
  }

  .immersion-bar,
  .immersion-form-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .immersion-form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--border-color);
  }

  .immersion-form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--type-small);
  }

  .immersion-form-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }

  .immersion-entries li {
    padding: 0.25rem 0;
  }

  .immersion-day {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .immersion-what {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    overflow-wrap: anywhere;
  }
</style>
