<script lang="ts">
  /**
   * One tap to download and import the bundled JMdict (lib/data/jmdict.ts), with its progress and
   * credit; the releases link where this build has no copy (dev builds). Never starts on its own:
   * the download is about 16 MB. Not part of upstream.
   */
  import { onMount } from 'svelte';
  import { dictionaries$ } from '$lib/data/dictionary';
  import { bundledJmdictSize, hasJmdict, installJmdict, jmdictReleases } from '$lib/data/jmdict';
  import { t$ } from '$lib/i18n';

  interface Props {
    /** Called once the dictionary is in */
    ondone?: () => void;
  }

  let { ondone }: Props = $props();

  /** null while checking; undefined when this build has none */
  let size = $state<number | undefined | null>(null);
  let progress = $state<{ done: number; total: number } | undefined>();
  let error = $state('');

  onMount(() => {
    bundledJmdictSize().then((bytes) => (size = bytes));
  });

  async function install() {
    error = '';
    progress = { done: 0, total: 0 };
    try {
      const { result, errors } = await installJmdict((done, total) => (progress = { done, total }));
      if (!result) throw new Error(errors[0] ?? $t$('dict.installFailed'));
      ondone?.();
    } catch (cause: any) {
      error = cause.message;
    }
    progress = undefined;
  }
</script>

{#if hasJmdict($dictionaries$)}
  <p class="install-note">{$t$('dict.jmdictInstalled')}</p>
{:else if progress}
  <div class="install-progress">
    <div
      class="install-track"
      role="progressbar"
      aria-label={$t$('dict.installingJmdict')}
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.done}
    >
      <div
        class="install-fill"
        style:width="{progress.total ? (progress.done / progress.total) * 100 : 0}%"
      ></div>
    </div>
    <p class="install-note">{$t$('dict.installingJmdict')}</p>
  </div>
{:else if size !== null}
  <span class="install-actions">
    {#if size === undefined}
      <a class="app-button" href={jmdictReleases} target="_blank" rel="noreferrer"
        >{$t$('dict.getJmdict')}</a
      >
    {:else}
      <button type="button" class="app-button app-button-primary" onclick={install}>
        {size
          ? $t$('dict.installJmdict', { size: Math.max(1, Math.round(size / 1e6)) })
          : $t$('dict.installJmdictNoSize')}
      </button>
      <span class="install-note">{$t$('dict.jmdictCredit')}</span>
    {/if}
  </span>
  {#if error}
    <p class="install-note install-error" role="alert">{error}</p>
  {/if}
{/if}

<style>
  .install-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .install-progress {
    display: grid;
    gap: 0.5rem;
    min-width: 12rem;
  }

  .install-track {
    height: 3px;
    background: var(--app-progress-track);
  }

  .install-fill {
    height: 100%;
    background: var(--app-progress-fill);
  }

  .install-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .install-error {
    color: var(--app-danger-color);
  }
</style>
