<script lang="ts">
  /**
   * A browser-stored manga's text on its book page (mokuro.ts): whether it has some, uploading a
   * .mokuro file, and making it in this browser with Manga text (manga-ocr.ts) where that runs.
   */
  import { onDestroy } from 'svelte';
  import { pagePath, standalone } from '$lib/data/env';
  import {
    cancelMangaTextJob,
    checkMangaText,
    makeMangaText,
    mangaTextJob$,
    mangaTextState$,
    mangaTextSupported
  } from '$lib/data/manga-ocr';
  import {
    keptMokuro,
    localMokuroChanged$,
    readMokuroFile,
    removeLocalMokuro,
    saveLocalMokuro,
    type MokuroText
  } from '$lib/data/mokuro';
  import { t$ } from '$lib/i18n';

  interface Props {
    title: string;
  }

  let { title }: Props = $props();

  let text = $state<MokuroText | undefined>();
  let error = $state('');
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();

  const canMake = standalone && mangaTextSupported();
  const job = $derived($mangaTextJob$);
  const running = $derived(job?.title === title ? job : undefined);

  $effect(() => {
    load(title);
  });

  if (canMake) checkMangaText();

  const changed = localMokuroChanged$.subscribe((changedTitle) => {
    if (changedTitle === title) load(title);
  });

  onDestroy(() => changed.unsubscribe());

  async function load(forTitle: string) {
    const kept = await keptMokuro(forTitle);

    if (forTitle === title) text = kept;
  }

  async function run(action: () => Promise<unknown>) {
    busy = true;
    error = '';

    try {
      await action();
    } catch (err: any) {
      error = err.name === 'AbortError' ? '' : err.message;
    } finally {
      busy = false;
    }
  }

  function upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];

    fileInput!.value = '';
    if (file) run(async () => saveLocalMokuro(title, await readMokuroFile(file)));
  }
</script>

{#if text}
  {$t$(text.source === 'browser' ? 'library.mokuroBrowser' : 'library.mokuroUploaded', {
    date: new Date(text.created).toLocaleDateString()
  })}
  <span class="mokuro-note">{$t$('library.mokuroLocal')}</span>
{:else}
  {$t$('library.noPageText')}
{/if}
{#if running}
  <span class="mokuro-note" role="status">
    {running.done
      ? $t$('library.readingPage', {
          page: Math.min(running.done + 1, running.total),
          total: running.total
        })
      : $t$('library.mokuroLoading')}
  </span>
{:else if job}
  <span class="mokuro-note">{$t$('library.mokuroOtherJob', { title: job.title })}</span>
{/if}
{#if error}
  <span class="block text-sm text-danger" role="alert">{error}</span>
{/if}
<span class="mokuro-actions">
  {#if running}
    <button type="button" class="app-button app-button-quiet" onclick={cancelMangaTextJob}>
      {$t$('library.stop')}
    </button>
  {:else if canMake && $mangaTextState$ === 'ready'}
    <button
      type="button"
      class="app-button app-button-quiet"
      disabled={busy || !!job}
      title={$t$('library.mokuroMakeHint')}
      onclick={() => run(() => makeMangaText(title))}
    >
      {text ? $t$('library.mokuroMakeHereAgain') : $t$('library.mokuroMakeHere')}
    </button>
  {/if}
  <button
    type="button"
    class="app-button app-button-quiet"
    disabled={busy}
    onclick={() => fileInput?.click()}
  >
    {$t$('library.mokuroUpload')}
  </button>
  {#if text && !running}
    <button
      type="button"
      class="app-button app-button-quiet"
      disabled={busy}
      onclick={() => run(() => removeLocalMokuro(title))}
    >
      {$t$('library.remove')}
    </button>
  {/if}
  <input
    bind:this={fileInput}
    type="file"
    accept=".mokuro,application/json"
    hidden
    onchange={upload}
  />
</span>
{#if canMake && ($mangaTextState$ === 'absent' || $mangaTextState$ === 'downloading') && !text}
  <a class="mokuro-note underline" href="{pagePath}/settings?section=general#general-analysis">
    {$t$('library.mokuroGetTools')}
  </a>
{/if}

<style>
  .mokuro-note {
    display: block;
    color: var(--app-muted-fg);
    font-size: 0.85rem;
  }

  .mokuro-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }
</style>
