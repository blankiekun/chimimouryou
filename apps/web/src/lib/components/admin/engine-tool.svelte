<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { getUpdateState, requestEngineUpdate, type UpdateState } from '$lib/data/account';
  import { checkEngineRelease, engineRepo } from '$lib/data/app-update';
  import { pagePath } from '$lib/data/env';

  const pollMs = 3000;

  let check: Awaited<ReturnType<typeof checkEngineRelease>> | undefined;
  let state: UpdateState | undefined;
  let checking = false;
  let error = '';
  /** The release asked for here, while waiting for the updater. */
  let updatingTo = '';
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  // Older servers report engine installs in `status`.
  $: status = state?.engineStatus ?? state?.status;
  $: finished = !!updatingTo && status?.ref === updatingTo && status.state !== 'running';
  $: canUpdate = !!state?.updater && !!check?.newer && check.webBuild;

  onMount(refresh);
  onDestroy(() => clearTimeout(pollTimer));

  async function refresh() {
    checking = true;
    error = '';

    try {
      state = await getUpdateState().catch(() => undefined);

      const response = await fetch(`${pagePath}/vn/conscripter-version.txt`, { cache: 'no-store' });

      check = await checkEngineRelease(response.ok ? await response.text() : 'unknown');
    } catch (e: any) {
      error = e.message;
    } finally {
      checking = false;
    }
  }

  async function update() {
    if (!check) {
      return;
    }

    error = '';

    try {
      state = await requestEngineUpdate(check.latest);
      updatingTo = check.latest;
      poll();
    } catch (e: any) {
      error = e.message;
    }
  }

  /** Failed requests just mean "try again". */
  async function poll() {
    try {
      state = await getUpdateState();
    } catch {
      // Try again
    }

    const latest = state?.engineStatus ?? state?.status;

    if (!(latest?.ref === updatingTo && latest.state !== 'running')) {
      pollTimer = setTimeout(poll, pollMs);
    }
  }
</script>

<p class="tool-text">
  Visual novels play on
  <a href="https://github.com/{engineRepo}" target="_blank" rel="noreferrer">CONscripter</a>. A new
  release isn't installed on its own: "Install" downloads the release's web build from GitHub into
  the server's data folder, where it replaces the built-in engine right away (nothing is built or
  restarted; games started afterwards use it). An app update that ships the same or a newer engine
  takes over again. Without the server's updater, run <code>scripts/conscripter/build.sh</code>,
  commit the files it changes and deploy.
</p>

{#if checking}
  <p class="flex items-center gap-2"><Fa icon={faSpinner} spin /> Checking GitHub...</p>
{:else if check}
  <table class="app-table tool-table">
    <tbody>
      <tr>
        <th scope="row">Installed</th>
        <td>{check.installed}</td>
      </tr>
      <tr>
        <th scope="row">Latest release</th>
        <td
          ><a class="underline" href={check.url} target="_blank" rel="noreferrer">{check.latest}</a
          ></td
        >
      </tr>
      <tr>
        <th scope="row">Status</th>
        <td>
          {#if !check.newer}
            <span class="tool-status" data-state="ok">Up to date</span>
          {:else if check.webBuild}
            <span class="tool-status" data-state="warn">{check.latest} is available</span>
          {:else}
            <span class="tool-status">{check.latest} has no web build yet; check again later</span>
          {/if}
        </td>
      </tr>
      {#if state && !state.updater && check.newer}
        <tr>
          <th scope="row">Updater</th>
          <td>
            <span class="tool-status" data-state="warn">
              Not installed on this server (servers set up with scripts/deploy.sh have it)
            </span>
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
{/if}

<div class="tool-actions">
  <button class="app-button" disabled={checking || !!updatingTo} on:click={refresh}>
    Check again
  </button>
  {#if canUpdate && !updatingTo && check}
    <button class="app-button app-button-primary" on:click={update}>Install {check.latest}</button>
  {/if}
  {#if updatingTo && !finished}
    <span class="flex items-center gap-2" role="status">
      <Fa icon={faSpinner} spin />
      {#if status?.ref === updatingTo}
        {status.message}...
      {:else}
        Waiting for the server's updater...
      {/if}
    </span>
  {/if}
</div>

{#if finished && status}
  <p class="tool-note" class:tool-error={status.state === 'failed'}>
    {status.message} ({new Date(status.at * 1000).toLocaleString()}).
    {#if status.state === 'done'}
      <button class="app-button app-button-quiet" on:click={() => window.location.reload()}
        >Reload the page</button
      >
    {/if}
  </p>
{/if}

{#if error}
  <p class="tool-error">{error}</p>
{/if}
