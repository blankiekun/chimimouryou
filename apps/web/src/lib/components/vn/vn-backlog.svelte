<script lang="ts">
  /**
   * The /v player's Backlog sheet: the lines the player keeps for Anki mining (overlay.js), newest
   * first, with the built-in lookups and Yomitan on their text (`.vn-text`), their sound, and
   * "Use for last card" for a card mined elsewhere. Not upstream.
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

  interface Props {
    /** The player frame, whose overlay.js keeps the lines */
    frame?: HTMLIFrameElement;
    /** Anki mining is on, so the player keeps lines */
    keeping: boolean;
    /** A tap on the text, for the built-in lookups */
    ontap?: (x: number, y: number) => void;
  }

  let { frame, keeping, ontap }: Props = $props();

  let lines: BacklogLine[] = $state([]);
  let message = $state('');
  let failed = $state(false);
  let busy = $state(false);
  let playing: HTMLAudioElement | undefined;

  const player = () => frame?.contentWindow as any;

  // New lines and dropped media while the sheet is open.
  $effect(() => {
    let last = '';
    const read = () => {
      const kept: KeptLine[] = player()?.keptLineList?.() ?? [];
      const next = JSON.stringify(kept);

      if (next !== last) {
        last = next;
        lines = backlogLines(kept);
      }
    };
    const timer = setInterval(read, 1000);

    read();
    return () => {
      clearInterval(timer);
      playing?.pause();
    };
  });

  function show(text: string, isError = false) {
    message = text;
    failed = isError;
  }

  async function play(line: BacklogLine) {
    const { audio } = await player().ankiMedia(line.index, -1, { picture: false, audio: true });

    if (!audio) {
      show('Its sound is no longer kept.', true);
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
      const filled = await useForLastNote(line.text, () =>
        player().ankiMedia(line.index, -1, {
          // Not the screen as it is now when the line's own is gone.
          picture: $ankiVnScreenshot$ && line.picture,
          audio: $ankiVnAudio$
        })
      );

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
  {#if !keeping}
    <p class="backlog-muted backlog-empty">
      Turn on Anki mining in Settings → Anki, then open the game again.
    </p>
  {:else}
    <SectionHead number={1} title="Lines" count={lines.length} level="h3" />
    {#if message}
      <p class="backlog-message" class:text-danger={failed} role="status">{message}</p>
    {/if}
    {#if lines.length}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <ol
        class="backlog-lines"
        onclick={(event) => {
          if ((event.target as Element).closest('.vn-text')) ontap?.(event.clientX, event.clientY);
        }}
      >
        {#each lines as line}
          <li class="backlog-line">
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
                <button
                  class="app-button app-button-quiet"
                  title="Put this line, its picture and sound on the newest Anki card"
                  disabled={busy}
                  onclick={() => useForLastCard(line)}
                >
                  Use for last card
                </button>
              </span>
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="backlog-muted backlog-empty">No lines yet. Lines show here as you read.</p>
    {/if}
  {/if}
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
