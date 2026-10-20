<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { buttonClasses } from '$lib/css-classes';
  import { account$ } from '$lib/data/account';
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
    /** File names of the installed term dictionaries (older services: missing) */
    termDictionaries?: string[];
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

  /** Installs jiten_freq_global.zip on the server (it checks the file; admins only). */
  async function importDictionary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    input.value = '';
    if (!file) {
      return;
    }

    importing = true;
    try {
      const upload = (force: boolean) =>
        fetch(`${difficultyApiUrl}dictionary${force ? '?force=1' : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: file
        });
      let response = await upload(false);

      // Replacing a list whose readings disagree with the installed one needs a confirmation.
      const agreement = response.status === 409 ? (await response.clone().json().catch(() => ({}))).agreement : undefined;

      if (
        typeof agreement === 'number' &&
        confirm(
          tr('library.dictionaryMismatch', {
            agreement: agreement.toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 1 })
          })
        )
      ) {
        response = await upload(true);
      }

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

  /** Installs a Yomitan term dictionary on the server under its file name (it checks the file; admins only). */
  async function importTermDictionary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    input.value = '';
    if (file) {
      importing = true;
      await post(`terms?name=${encodeURIComponent(file.name)}`, file);
      importing = false;
    }
  }

  async function post(action: string, body: object | File = {}) {
    try {
      const response = await fetch(`${difficultyApiUrl}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': body instanceof File ? 'application/zip' : 'application/json' },
        body: body instanceof File ? body : JSON.stringify(body)
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
        {#if $account$?.admin}
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
        {:else}
          <p>{$t$('library.dictionaryNeededAdmin')}</p>
        {/if}
      </div>
    {/if}
    {#if $account$?.admin && status.termDictionaries}
      <section class="flex flex-col gap-2">
        <p>{$t$('library.termDictionaries')}</p>
        {#each status.termDictionaries as name (name)}
          <div class="flex items-center gap-2">
            <span class="break-all">{name}</span>
            <button
              class={buttonClasses}
              disabled={running || importing}
              on:click={() => post('terms/remove', { name })}
            >
              {$t$('library.removeTermDictionary')}
            </button>
          </div>
        {/each}
        <label class="{buttonClasses} flex cursor-pointer items-center gap-2 self-start">
          {#if importing}<Fa icon={faSpinner} spin />{/if}
          {$t$('library.addTermDictionary')}
          <input
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            disabled={importing || running}
            on:change={importTermDictionary}
          />
        </label>
      </section>
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
