<script lang="ts">
  import { faMinus, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
  import {
    audiobookControlDefaults,
    audiobookControls$,
    setAudiobookControl
  } from '$lib/data/audiobook-controls';
  import {
    rateMax,
    rateMin,
    ratePresets,
    rateStep,
    stepRate
  } from '$lib/functions/audiobook/playback';
  import {
    playbackKeys,
    type PlaybackController
  } from '$lib/functions/audiobook/playback-controller';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /** The speed and options panels of `audiobook-controls.svelte`, below the player. */
  interface Props {
    controller: PlaybackController;
    /** The audiobook has subtitle lines */
    hasLines: boolean;
  }

  let { controller, hasLines }: Props = $props();
  // The controller's state, as a store
  let playback = $derived(controller.state$);
  let options = $derived({ ...audiobookControlDefaults, ...$audiobookControls$ });

  const seekChoices = [2, 3, 5, 10, 15, 30];
  const loopChoices = [0, 2, 3, 5];
  const gapChoices = [0, 1, 2, 3, 5, -1];
  const sleepChoices = [5, 10, 15, 30, 45, 60];

  const sleepEnd = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

{#if $playback.panel}
  <div
    class="abc-panel reader-panel"
    role="group"
    aria-label={$t$($playback.panel === 'speed' ? 'reader.speed' : 'reader.abOptions')}
  >
    <div class="abc-header">
      <span class="flex-1 font-semibold"
        >{$t$($playback.panel === 'speed' ? 'reader.speed' : 'reader.abOptions')}</span
      >
      <button
        class="abc-icon"
        title={$t$('reader.close')}
        onclick={() => controller.togglePanel($playback.panel)}
      >
        <Fa icon={faXmark} />
      </button>
    </div>

    {#if $playback.panel === 'speed'}
      <div class="abc-presets">
        {#each ratePresets as preset (preset)}
          <button
            class="abc-chip"
            class:abc-chip-on={$playback.rate === preset}
            aria-pressed={$playback.rate === preset}
            onclick={() => controller.setRate(preset)}>{preset}×</button
          >
        {/each}
      </div>
      <div class="abc-row">
        <button
          class="abc-icon"
          title="{$t$('reader.abSlower')} ([)"
          disabled={$playback.rate <= rateMin}
          onclick={() => controller.setRate(stepRate($playback.rate, -1))}
        >
          <Fa icon={faMinus} />
        </button>
        <input
          class="abc-range"
          type="range"
          min={rateMin}
          max={rateMax}
          step={rateStep}
          value={$playback.rate}
          aria-label={$t$('reader.speed')}
          oninput={(event) => controller.setRate(Number(event.currentTarget.value))}
        />
        <button
          class="abc-icon"
          title="{$t$('reader.abFaster')} (])"
          disabled={$playback.rate >= rateMax}
          onclick={() => controller.setRate(stepRate($playback.rate, 1))}
        >
          <Fa icon={faPlus} />
        </button>
        <span class="abc-rate">{$playback.rate.toFixed(2)}×</span>
      </div>
    {:else}
      <label class="abc-field">
        <span>{$t$('reader.abSeekStep')}</span>
        <select
          class="app-input"
          value={options.seekSeconds}
          onchange={(event) =>
            setAudiobookControl('seekSeconds', Number(event.currentTarget.value))}
        >
          {#each seekChoices as seconds (seconds)}
            <option value={seconds}>{$t$('reader.abSeconds', { seconds })}</option>
          {/each}
        </select>
      </label>
      {#if hasLines}
        <label class="abc-field">
          <span>{$t$('reader.abLoopCount')}</span>
          <select
            class="app-input"
            value={options.loopCount}
            onchange={(event) =>
              setAudiobookControl('loopCount', Number(event.currentTarget.value))}
          >
            {#each loopChoices as count (count)}
              <option value={count}
                >{count ? $t$('reader.abTimes', { count }) : $t$('reader.abUntilOff')}</option
              >
            {/each}
          </select>
        </label>
        <label class="abc-field">
          <span>{$t$('reader.abAutoPauseGap')}</span>
          <select
            class="app-input"
            value={options.autoPauseGap}
            onchange={(event) =>
              setAudiobookControl('autoPauseGap', Number(event.currentTarget.value))}
          >
            {#each gapChoices as gap (gap)}
              <option value={gap}
                >{gap === 0
                  ? $t$('reader.abGapWait')
                  : gap < 0
                    ? $t$('reader.abGapLine')
                    : $t$('reader.abSeconds', { seconds: gap })}</option
              >
            {/each}
          </select>
        </label>
        <label class="abc-check">
          <input
            type="checkbox"
            checked={options.follow}
            onchange={(event) => setAudiobookControl('follow', event.currentTarget.checked)}
          />
          {$t$('reader.abFollow')}
        </label>
      {/if}
      <label class="abc-check">
        <input
          type="checkbox"
          checked={options.pauseOnLookup}
          onchange={(event) => setAudiobookControl('pauseOnLookup', event.currentTarget.checked)}
        />
        {$t$('reader.abPauseOnLookup')}
      </label>
      <label class="abc-field">
        <span
          >{$playback.sleepAt
            ? $t$('reader.abSleepUntil', { time: sleepEnd($playback.sleepAt) })
            : $t$('reader.abSleep')}</span
        >
        <select
          class="app-input"
          value={0}
          onchange={(event) => {
            controller.setSleep(Number(event.currentTarget.value));
            event.currentTarget.value = '0';
          }}
        >
          <option value={0}
            >{$t$($playback.sleepAt ? 'reader.abSleepOff' : 'reader.abSleepPick')}</option
          >
          {#each sleepChoices as minutes (minutes)}
            <option value={minutes}>{$t$('reader.abMinutes', { minutes })}</option>
          {/each}
        </select>
      </label>
      <details class="abc-keys">
        <summary>{$t$('reader.abKeys')}</summary>
        <dl>
          {#each playbackKeys as key (key.code)}
            <dt><kbd>{key.keys}</kbd></dt>
            <dd>{$t$(key.label)}</dd>
          {/each}
        </dl>
        <p class="abc-hint">{$t$('reader.abKeysHint')}</p>
      </details>
    {/if}
  </div>
{/if}

<style>
  .abc-panel {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.6rem 0.75rem 0.75rem;
    border-radius: 2px;
  }

  .abc-header,
  .abc-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .abc-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    opacity: 0.75;
  }

  .abc-icon:hover:not(:disabled) {
    background: color-mix(in srgb, var(--reader-panel-fg) 12%, transparent);
    opacity: 1;
  }

  .abc-icon:disabled {
    opacity: 0.35;
  }

  .abc-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.6rem;
  }

  .abc-chip {
    min-width: 3rem;
    padding: 0.35rem 0.5rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--reader-panel-fg) 10%, transparent);
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .abc-chip:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 20%, transparent);
  }

  .abc-chip-on,
  .abc-chip-on:hover {
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .abc-range {
    min-width: 0;
    flex: 1;
    accent-color: var(--accent-color);
  }

  .abc-rate {
    min-width: 3rem;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .abc-field {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
  }

  .abc-field > span {
    flex: 1;
  }

  .abc-field select {
    max-width: 55%;
  }

  .abc-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
  }

  .abc-hint {
    font-size: var(--type-small);
    opacity: 0.7;
  }

  .abc-keys {
    margin-top: 0.25rem;
    font-size: 0.75rem;
  }

  .abc-keys summary {
    cursor: pointer;
    font-weight: 600;
  }

  .abc-keys dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0.5rem 0;
  }

  .abc-keys kbd {
    padding: 0 0.3rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 25%, transparent);
    border-radius: 2px;
    font-family: inherit;
    font-size: var(--type-label);
  }
</style>
