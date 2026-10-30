<script lang="ts">
  /**
   * /hook's thread picker for a game played natively: LunaHook sends each line on several
   * threads (one per hooked function or engine hook); the reader picks the one with the game's
   * text, ranked by rankThreads (one line per burst, Japanese, few repeats). The pick is saved on
   * the game's record (VnInfo.nativeHook) by the page.
   */
  import SectionHead from '$lib/components/section-head.svelte';
  import type { NativeHook, NativeThread } from '$lib/data/vn/native-games';

  interface Props {
    ranked: { thread: NativeThread; score: number }[];
    hook: NativeHook | undefined;
    onpick: (thread: NativeThread) => void;
  }

  let { ranked, hook, onpick }: Props = $props();

  // The same hook on several contexts shows once: its best thread.
  const rows = $derived(
    ranked.filter(
      (row, index) =>
        ranked.findIndex((other) => other.thread.hookcode === row.thread.hookcode) === index
    )
  );
</script>

<div class="nt">
  <SectionHead number={1} title="Text thread" level="h3" count={rows.length} />
  {#if !rows.length}
    <p class="nt-note">Waiting for the game’s first line…</p>
  {:else}
    <p class="nt-note">
      {hook
        ? 'Lines come from the marked thread. Pick another if it isn’t the game’s text.'
        : 'Pick the thread that shows the game’s text. It is saved for this game.'}
    </p>
    <ul class="nt-list">
      {#each rows as { thread, score }, index (thread.hookcode)}
        {@const current = thread.hookcode === hook?.hookcode}
        <li>
          <button
            type="button"
            class="nt-row"
            class:nt-current={current}
            aria-pressed={current}
            onclick={() => onpick(thread)}
          >
            <span class="nt-head">
              <span class="nt-name">{thread.label}</span>
              {#if current}<span class="nt-tag">Picked</span>
              {:else if index === 0 && score >= 0.5}<span class="nt-tag nt-tag-quiet"
                  >Suggested</span
                >{/if}
              <span class="nt-count">{thread.count}</span>
            </span>
            <span class="nt-last" lang="ja">{thread.last}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .nt {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .nt-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .nt-list {
    max-height: 22rem;
    overflow-y: auto;
    border-top: 2px solid var(--font-color);
  }

  .nt-list li {
    border-bottom: 1px solid var(--border-color);
  }

  .nt-row {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    border-left: 3px solid transparent;
    text-align: left;
  }

  .nt-row:hover {
    background: color-mix(in srgb, var(--font-color) 6%, transparent);
  }

  .nt-current {
    border-left-color: var(--accent-color);
  }

  .nt-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--type-small);
  }

  .nt-name {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 700;
  }

  .nt-tag {
    color: var(--accent-color);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .nt-tag-quiet {
    font-weight: 400;
  }

  .nt-count {
    margin-left: auto;
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .nt-last {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
