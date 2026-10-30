<script lang="ts">
  /** The manga reader's (/m) bottom bar: page slider, percent, the phone's mode/text row. Not upstream. */
  import { fly } from 'svelte/transition';
  import type { MangaReadingMode } from '$lib/data/manga';

  interface Props {
    mode: MangaReadingMode;
    pageIndex: number;
    pageCount: number;
    pagesLabel: string;
    /** Where the slider's thumb is, 0-100 from its start */
    sliderAt: number;
    volumeLabel: string;
    percent: number;
    modeLabel: string;
    hasText: boolean;
    textLabel: string;
    openError: string;
    onpage: (index: number) => void;
    onmode: () => void;
    ontext: () => void;
  }

  let {
    mode,
    pageIndex,
    pageCount,
    pagesLabel,
    sliderAt,
    volumeLabel,
    percent,
    modeLabel,
    hasText,
    textLabel,
    openError,
    onpage,
    onmode,
    ontext
  }: Props = $props();
</script>

<div class="manga-bottom" transition:fly={{ y: 40, duration: 150 }}>
  <div class="manga-slider-row">
    <div class="manga-slider-track" dir={mode === 'rtl' ? 'rtl' : 'ltr'}>
      <span class="manga-end">1</span>
      <div class="manga-slider">
        <!-- Over the thumb's centre: the thumb (1rem) travels the track less its width. -->
        <span
          class="manga-bubble"
          dir="ltr"
          style="{mode === 'rtl' ? 'right' : 'left'}: calc({sliderAt}% + {(50 - sliderAt) *
            0.01}rem)"
        >
          {pagesLabel}
        </span>
        <input
          type="range"
          min="0"
          max={Math.max(pageCount - 1, 0)}
          value={pageIndex}
          aria-label="Page"
          style:background="linear-gradient(to {mode === 'rtl' ? 'left' : 'right'},
          var(--accent-color) {sliderAt}%, var(--app-progress-track) {sliderAt}%)"
          oninput={(event) => onpage(Number(event.currentTarget.value))}
        />
      </div>
      <span class="manga-end">{pageCount}</span>
    </div>
    <span class="manga-percent">{[volumeLabel, `${percent}%`].filter(Boolean).join(' · ')}</span>
  </div>
  <div class="manga-phone-row">
    <button onclick={onmode}>{modeLabel}</button>
    {#if hasText}
      <button onclick={ontext}>
        Text: {textLabel}
      </button>
    {/if}
  </div>
  {#if openError}
    <div class="pt-2 text-center text-danger">{openError}</div>
  {/if}
</div>

<style>
  .manga-bottom {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 10;
    padding: 1.75rem 1.25rem 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .manga-slider-row,
  .manga-slider-track {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .manga-slider-track {
    flex: 1;
  }

  .manga-end,
  .manga-percent {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    white-space: nowrap;
  }

  .manga-percent {
    margin-left: 0.5rem;
  }

  .manga-slider {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
  }

  .manga-bubble {
    position: absolute;
    bottom: 1rem;
    padding: 0.05rem 0.4rem;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }

  [dir='rtl'] .manga-bubble {
    transform: translateX(50%);
  }

  /* Square thumb on a 3px track; the read part is filled (inline background) */
  .manga-slider input {
    width: 100%;
    height: 3px;
    appearance: none;
    border-radius: 0;
    cursor: pointer;
  }

  .manga-slider input::-webkit-slider-thumb {
    width: 1rem;
    height: 1rem;
    appearance: none;
    border-radius: 2px;
    background: var(--accent-color);
  }

  .manga-slider input::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    border: 0;
    border-radius: 2px;
    background: var(--accent-color);
  }

  .manga-phone-row {
    display: none;
  }

  @media (max-width: 767px) {
    .manga-percent {
      display: none;
    }

    .manga-phone-row {
      display: flex;
      justify-content: space-between;
      padding-top: 0.5rem;
      color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
      font-size: var(--type-body);
    }

    .manga-phone-row button {
      min-height: 2.75rem;
    }
  }
</style>
