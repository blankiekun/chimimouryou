<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { buttonClasses } from '$lib/css-classes';
  import { difficultyApiUrl } from '$lib/data/calibre';
  import { t$, tr } from '$lib/i18n';
  import { onDestroy, onMount } from 'svelte';
  import Fa from 'svelte-fa';

  /** Calibre ids of the selected books, if any */
  export let selectedIds: number[] = [];

  interface Status {
    job: {
      type: 'compute';
      done: number;
      total: number;
      started: number;
      finished?: number;
      cancelled?: boolean;
      error?: string;
    } | null;
    /** Whether the frequency list is installed on the server */
    dictionary: boolean;
    results: number;
    /** Books without enough text to estimate (image-only manga and scans) */
    noText?: number;
    /** Books whose file can't be read (not a zip, no container.xml) */
    failed?: number;
    workers: number;
  }

  let status: Status | undefined;
  let error = '';
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set when a job started here has finished, so the library can be reloaded. */
  export let finishedCompute = false;

  $: running = !!status?.job && !status.job.finished;
  /** The sentence around the file name and link, which go where the language puts them */
  $: dictionaryParts = $t$('library.dictionaryNeeded').split(/(\{file\}|\{link\})/);

  onMount(poll);

  onDestroy(() => clearTimeout(pollTimer));

  async function poll() {
    clearTimeout(pollTimer);

    try {
      const response = await fetch(`${difficultyApiUrl}status`, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(tr('library.difficultyUnavailable', { status: response.status }));
      }

      const wasRunning = running;

      status = await response.json();
      error = '';

      if (wasRunning && !running) {
        finishedCompute = true;
      }
    } catch (e: any) {
      error = e.message;
    }

    if (running) {
      pollTimer = setTimeout(poll, 2000);
    }
  }

  let importing = false;

  /** Installs jiten_freq_global.zip on the server (it checks the file). */
  async function importDictionary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    input.value = '';
    if (!file) {
      return;
    }

    importing = true;
    try {
      const response = await fetch(`${difficultyApiUrl}dictionary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file
      });

      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => ({}))).error || `HTTP ${response.status}`
        );
      }

      status = await response.json();
      error = '';
    } catch (e: any) {
      error = e.message;
    } finally {
      importing = false;
    }
  }

  async function post(action: string, body: object = {}) {
    try {
      const response = await fetch(`${difficultyApiUrl}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => ({}))).error || `HTTP ${response.status}`
        );
      }

      finishedCompute = false;
      status = await response.json();
      error = '';
      poll();
    } catch (e: any) {
      error = e.message;
    }
  }
</script>

<div class="flex max-w-xl flex-col gap-4 text-sm">
  <p>
    {$t$('library.difficultyIntro', {
      beginner: $t$('difficulty.beginner'),
      insane: $t$('difficulty.insane')
    })}
  </p>

  {#if error}
    <p class="text-[color:var(--app-danger-color)]">{error}</p>
  {/if}

  {#if !status && !error}
    <p class="flex items-center gap-2"><Fa icon={faSpinner} spin /> {$t$('library.loadingStatus')}</p>
  {:else if status}
    {#if !status.dictionary}
      <div class="flex flex-col gap-2">
        <p>
          {#each dictionaryParts as part}{#if part === '{file}'}<strong>jiten_freq_global.zip</strong
              >{:else if part === '{link}'}<a
                class="underline"
                href="https://jiten.moe/frequency-dictionaries"
                target="_blank"
                rel="noreferrer">jiten.moe/frequency-dictionaries</a
              >{:else}{part}{/if}{/each}
        </p>
        <label class="{buttonClasses} flex cursor-pointer items-center gap-2 self-start">
          {#if importing}<Fa icon={faSpinner} spin />{/if}
          {$t$('library.importDictionary')}
          <input
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            disabled={importing}
            on:change={importDictionary}
          />
        </label>
      </div>
    {/if}
    <div class="flex flex-wrap gap-2">
      <button
        class={buttonClasses}
        title={$t$('library.runHint')}
        disabled={running || !status.dictionary}
        on:click={() => post('compute', { all: true })}
      >
        {$t$('library.run')}
      </button>
      {#if selectedIds.length}
        <button
          class={buttonClasses}
          disabled={running || !status.dictionary}
          on:click={() => post('compute', { ids: selectedIds })}
        >
          {$t$('library.selectedBooks', { count: selectedIds.length })}
        </button>
      {/if}
    </div>

    {#if status.job}
      {@const job = status.job}
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          {#if running}<Fa icon={faSpinner} spin />{/if}
          <span class="font-semibold">
            {$t$('library.estimating', {
              done: job.done.toLocaleString(),
              total: job.total.toLocaleString()
            })}
            {#if job.cancelled}{$t$('library.jobCancelled')}{:else if job.error}{$t$(
                'library.jobFailed'
              )}{:else if job.finished}{$t$('library.jobDone')}{/if}
          </span>
        </div>
        <progress class="w-full" value={job.done} max={job.total || 1} />
        {#if job.error}
          <p class="text-[color:var(--app-danger-color)]">{job.error}</p>
        {/if}
        {#if running}
          <button class="{buttonClasses} self-start" on:click={() => post('cancel')}>
            {$t$('book.cancel')}
          </button>
        {/if}
      </section>
    {/if}
  {/if}
</div>
