<script lang="ts">
  /**
   * The /v player's Backlog (the sidebar beside the game, a sheet on portrait phones): the lines the
   * player keeps (overlay.js), newest at the bottom and followed unless the reader scrolled up, the
   * current page's marked, with the built-in lookups and Yomitan on their text (`.vn-text`), their
   * sound, and "Use for last card" for a card mined elsewhere. Not upstream.
   */
  import Fa from 'svelte-fa';
  import { faPlay } from '@fortawesome/free-solid-svg-icons';
  import SectionHead from '$lib/components/section-head.svelte';
  import {
    ankiSentenceField$,
    ankiVnAudio$,
    ankiVnScreenshot$,
    useForLastNote
  } from '$lib/data/dictionary/anki';
  import { backlogLines, type BacklogLine, type KeptLine } from '$lib/data/vn/vn-backlog';
  import { lineAudio } from '$lib/data/vn/line-audio';

  interface Props {
    /** The player frame, whose overlay.js keeps the lines */
    frame?: HTMLIFrameElement;
    /** Anki mining is on: "Use for last card" */
    anki: boolean;
    /** Changes with each new page or line (the page's text), to read the new line at once */
    shown?: unknown;
    /** A tap on the text, for the built-in lookups */
    ontap?: (x: number, y: number) => void;
  }

  let { frame, anki, shown, ontap }: Props = $props();

  let lines: BacklogLine[] = $state([]);
  /** Kept-line index where the current page starts: the click waits it grew by */
  let pageStart = $state(0);
  let end: HTMLElement | undefined = $state();
  /** The end of the list is in view: new lines scroll into view */
  let following = true;
  let message = $state('');
  let failed = $state(false);
  let busy = $state(false);
  let playing: HTMLAudioElement | undefined;

  const player = () => frame?.contentWindow as any;

  let last = '';

  function read() {
    const kept: KeptLine[] = player()?.keptLineList?.() ?? [];
    const next = JSON.stringify(kept);

    if (next === last) return;
    last = next;
    lines = backlogLines(kept).reverse();
    pageStart = kept.length - 1;
    while (pageStart > 0 && kept[pageStart].text.startsWith(kept[pageStart - 1].text)) {
      pageStart -= 1;
    }
  }

  // New lines and dropped media while it is open.
  $effect(() => {
    const timer = setInterval(read, 1000);

    read();
    return () => {
      clearInterval(timer);
      playing?.pause();
    };
  });

  // The player keeps a line right after it hands the page its text.
  $effect(() => {
    void shown;
    const timer = setTimeout(read);

    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!end) return;
    const observer = new IntersectionObserver(([entry]) => (following = entry.isIntersecting));

    observer.observe(end);
    return () => observer.disconnect();
  });

  $effect(() => {
    void lines;
    if (following) end?.scrollIntoView({ block: 'end' });
  });

  function show(text: string, isError = false) {
    message = text;
    failed = isError;
  }

  async function play(line: BacklogLine) {
    const media = await player().ankiMedia(line.index, -1, { picture: false, audio: true });
    const audio = await lineAudio(media.audio, line.text);

    if (!audio) {
      // Voice only (Settings → Anki) finds no voice in a line with none.
      show(media.audio ? 'No voice found in its sound.' : 'Its sound is no longer kept.', true);
      return;
    }

    const url = URL.createObjectURL(audio);

    playing?.pause();
    playing = new Audio(url);
    playing.onended = playing.onpause = () => URL.revokeObjectURL(url);
    playing.play().catch((error) => show(`Could not play it: ${error.message}`, true));
  }

  async function useForLastCard(line: BacklogLine) {
    busy = true;
    show('Adding the line to the last Anki card…');
    try {
      const filled = await useForLastNote(line.text, async () => {
        const media = await player().ankiMedia(line.index, -1, {
          // Not the screen as it is now when the line's own is gone.
          picture: $ankiVnScreenshot$ && line.picture,
          audio: $ankiVnAudio$
        });

        return { picture: media.picture, audio: await lineAudio(media.audio, line.text) };
      });

      show(
        filled.length
          ? `Added to the last Anki card: ${filled.join(', ')}`
          : `Nothing added: the last card has no ${$ankiSentenceField$.trim()} field, and its media fields are missing or filled`
      );
    } catch (error: any) {
      show(`Anki: ${error.message}`, true);
    } finally {
      busy = false;
    }
  }
</script>

<div class="backlog">
  <SectionHead number={1} title="Lines" count={lines.length} level="h3" />
  {#if lines.length}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <ol
      class="backlog-lines"
      onclick={(event) => {
        if ((event.target as Element).closest('.vn-text')) ontap?.(event.clientX, event.clientY);
      }}
    >
      {#each lines as line}
        <li class="backlog-line" class:backlog-current={line.index >= pageStart}>
          <p class="vn-text" lang="ja">{line.text}</p>
          <div class="backlog-meta">
            {#if line.picture || line.sound}
              <span class="backlog-muted">
                {[line.picture && 'Picture', line.sound && 'Sound'].filter(Boolean).join(' · ')}
              </span>
            {/if}
            <span class="backlog-actions">
              {#if line.sound}
                <button
                  class="app-button app-button-quiet"
                  title="Play the line's sound"
                  onclick={() => play(line)}
                >
                  <Fa icon={faPlay} size="xs" /> Play
                </button>
              {/if}
              {#if anki}
                <button
                  class="app-button app-button-quiet"
                  title="Put this line, its picture and sound on the newest Anki card"
                  disabled={busy}
                  onclick={() => useForLastCard(line)}
                >
                  Use for last card
                </button>
              {/if}
            </span>
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="backlog-muted backlog-empty">No lines yet. Lines show here as you read.</p>
  {/if}
  {#if message}
    <p class="backlog-message" class:text-danger={failed} role="status">{message}</p>
  {/if}
  <div bind:this={end}></div>
</div>

<style>
  .backlog {
    padding-top: 1rem;
  }

  .backlog-muted {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .backlog-empty,
  .backlog-message {
    margin: 0.75rem 0 0;
  }

  .backlog-message {
    font-size: var(--type-small);
  }

  .backlog-lines {
    margin: 0.75rem 0 0;
    padding: 0;
    border-top: 2px solid currentColor;
    list-style: none;
  }

  .backlog-line {
    padding: 0.6rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  /* The current page's lines on the spot tint; the ones read before it a step quieter */
  .backlog-line:not(.backlog-current) .vn-text {
    color: color-mix(in srgb, var(--reader-panel-fg) 72%, transparent);
  }

  .backlog-current {
    margin: 0 -0.5rem;
    padding: 0.6rem 0.5rem;
    background: var(--app-spot-tint);
  }

  .backlog-line .vn-text {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.7;
  }

  .backlog-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1rem;
    margin-top: 0.25rem;
  }

  .backlog-actions {
    display: flex;
    gap: 1rem;
    margin-left: auto;
  }
</style>
