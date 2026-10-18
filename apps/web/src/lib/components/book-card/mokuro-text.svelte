<script lang="ts">
  /**
   * A Calibre manga's mokuro text on its book page: whether it has some, and for accounts with
   * the import permission, making it on the server or uploading a .mokuro file made elsewhere.
   */
  import { onDestroy } from 'svelte';
  import { account$, hasPermission } from '$lib/data/account';
  import {
    cancelMokuro,
    generateMokuro,
    loadMokuro,
    mokuroStatus,
    removeMokuro,
    uploadMokuro,
    type MokuroStatus,
    type MokuroText
  } from '$lib/data/mokuro';

  export let calibreId: number;

  let text: MokuroText | undefined;
  let status: MokuroStatus | undefined;
  let error = '';
  let busy = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let fileInput: HTMLInputElement;

  $: canEdit = hasPermission($account$, 'import');
  $: running = status?.job?.id === calibreId ? status.job : undefined;
  $: queuedAt = status?.queue.indexOf(calibreId) ?? -1;
  $: load(calibreId, canEdit);

  async function load(id: number, edit: boolean) {
    clearTimeout(pollTimer);
    text = undefined;
    status = undefined;
    error = '';
    text = await loadMokuro(id).catch(() => undefined);

    if (edit) await poll();
  }

  function isActive(current: MokuroStatus | undefined) {
    return current?.job?.id === calibreId || !!current?.queue.includes(calibreId);
  }

  async function poll() {
    clearTimeout(pollTimer);

    const wasActive = isActive(status);

    try {
      status = await mokuroStatus();
    } catch {
      // The mokuro profile isn't running: nothing to offer.
      status = undefined;
      return;
    }

    if (isActive(status)) {
      pollTimer = setTimeout(poll, 3000);
    } else if (wasActive) {
      text = await loadMokuro(calibreId).catch(() => undefined);
      error = status.last?.id === calibreId && status.last.error ? status.last.error : '';
    }
  }

  async function run(action: () => Promise<unknown>) {
    busy = true;
    error = '';

    try {
      await action();
    } catch (err: any) {
      error = err.message;
    } finally {
      busy = false;
    }
  }

  const generate = () =>
    run(async () => {
      status = await generateMokuro([calibreId]);
      await poll();
    });

  const cancel = () =>
    run(async () => {
      status = await cancelMokuro();
      await poll();
    });

  const remove = () =>
    run(async () => {
      await removeMokuro(calibreId);
      text = undefined;
    });

  function upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];

    fileInput.value = '';

    if (!file) return;

    run(async () => {
      await uploadMokuro(calibreId, file);
      text = await loadMokuro(calibreId);
    });
  }

  onDestroy(() => clearTimeout(pollTimer));
</script>

{#if text}
  Page text by mokuro ({text.source === 'server' ? 'made on the server' : 'uploaded'}
  {new Date(text.created).toLocaleDateString()})
{:else}
  No page text
{/if}
{#if running}
  <span class="mokuro-note">
    Reading page {Math.min(running.done + 1, running.total)} of {running.total}…
  </span>
{:else if queuedAt >= 0}
  <span class="mokuro-note">
    Waiting for {queuedAt + (status?.job ? 1 : 0)} other volume{queuedAt + (status?.job ? 1 : 0) ===
    1
      ? ''
      : 's'}
  </span>
{/if}
{#if error}
  <span class="block text-sm text-danger" role="alert">{error}</span>
{/if}
{#if canEdit && status}
  <span class="mokuro-actions">
    {#if running || queuedAt >= 0}
      <button type="button" class="app-button app-button-quiet" disabled={busy} on:click={cancel}>
        Stop
      </button>
    {:else if status.generator}
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={busy}
        title="About 5 seconds a page on a CPU"
        on:click={generate}
      >
        {text ? 'Make again on the server' : 'Make text on the server'}
      </button>
    {/if}
    <button
      type="button"
      class="app-button app-button-quiet"
      disabled={busy}
      on:click={() => fileInput.click()}
    >
      Upload .mokuro
    </button>
    {#if text}
      <button type="button" class="app-button app-button-quiet" disabled={busy} on:click={remove}>
        Remove
      </button>
    {/if}
    <input
      bind:this={fileInput}
      type="file"
      accept=".mokuro,application/json"
      hidden
      on:change={upload}
    />
  </span>
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
