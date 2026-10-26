<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import {
    libraryCovers$,
    pauseLibraryCovers,
    uploadLibraryCovers
  } from '$lib/data/library-covers';
  import { HubError, hubErrorKey } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';

  /** /moderation, devs on server builds: the library's covers to the hub for Discord statuses */
  interface Props {
    number: number;
  }

  let { number }: Props = $props();

  const upload = $derived($libraryCovers$);
  const total = $derived(upload.done + upload.skipped + upload.failed + upload.left);
  const started = $derived(total > 0);
  const share = $derived(total ? (total - upload.left) / total : 0);
  const stopped = $derived(
    !upload.stopped
      ? ''
      : upload.stopped === 'limit'
        ? $t$('moderation.libraryCoversLimit')
        : $t$(hubErrorKey(new HubError(0, upload.stopped)))
  );
  const counts = $derived([
    ['moderation.libraryCoversDone', upload.done],
    ['moderation.libraryCoversSkipped', upload.skipped],
    ['moderation.libraryCoversFailed', upload.failed],
    ['moderation.libraryCoversLeft', upload.left]
  ] as const);
</script>

<section class="library-covers" aria-labelledby="moderation-library-covers">
  <SectionHead id="moderation-library-covers" {number} title={$t$('moderation.libraryCovers')} />
  <p class="library-covers-note">{$t$('moderation.libraryCoversHint')}</p>

  {#if started}
    <dl class="library-covers-counts">
      {#each counts as [label, value] (label)}
        <div>
          <dt>{$t$(label)}</dt>
          <dd>{value.toLocaleString()}</dd>
        </div>
      {/each}
    </dl>
    <div
      class="library-covers-track"
      role="progressbar"
      aria-label={$t$('moderation.libraryCovers')}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(share * 100)}
    >
      <span style:width="{share * 100}%"></span>
    </div>
  {/if}
  {#if stopped}<p class="library-covers-error" role="alert">{stopped}</p>{/if}

  <div>
    {#if upload.running}
      <button type="button" class="app-button" onclick={pauseLibraryCovers}>
        {$t$('moderation.libraryCoversPause')}
      </button>
    {:else}
      <button type="button" class="app-button app-button-primary" onclick={uploadLibraryCovers}>
        {$t$(
          started && upload.left
            ? 'moderation.libraryCoversResume'
            : 'moderation.libraryCoversStart'
        )}
      </button>
    {/if}
  </div>
</section>

<style>
  .library-covers {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }

  .library-covers-note {
    max-width: 65ch;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .library-covers-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .library-covers-counts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 2px solid var(--font-color);
  }

  .library-covers-counts > div {
    padding: 0.5rem 0.75rem 0.5rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .library-covers-counts dt {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .library-covers-counts dd {
    font-size: var(--type-number);
    font-variant-numeric: tabular-nums;
  }

  .library-covers-track {
    height: 3px;
    background: var(--app-progress-track);
  }

  .library-covers-track > span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }
</style>
