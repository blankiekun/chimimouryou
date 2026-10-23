<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import { getUpdateState, requestUpdate, type UpdateState } from '$lib/data/account';
  import {
    checkForUpdate,
    defaultUpdateRepo,
    updateChannel$,
    type UpdateCheck
  } from '$lib/data/app-update';

  const pollMs = 3000;
  const shownCommits = 30;
  const channelOptions = [
    { id: 'stable', text: 'Stable' },
    { id: 'edge', text: 'Bleeding edge' }
  ];

  let state: UpdateState | undefined;
  let check: UpdateCheck | undefined;
  let checking = false;
  let error = '';
  /** The commit asked for here, while waiting for the updater. */
  let updatingTo = '';
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  $: repo = state?.updater || defaultUpdateRepo;
  $: status = state?.status;
  $: canUpdate =
    !!state?.updater && !!check && check.latest !== check.current && check.state !== 'ahead';
  $: finished = !!updatingTo && status?.ref === updatingTo && status.state !== 'running';

  let mounted = false;

  onMount(() => (mounted = true));

  // Checks on opening and again when the channel changes.
  $: if (mounted && $updateChannel$) refresh();

  onDestroy(() => clearTimeout(pollTimer));

  async function refresh() {
    checking = true;
    error = '';

    try {
      state = await getUpdateState();

      const version = await (await fetch('/version.txt', { cache: 'no-store' })).text();

      check = await checkForUpdate(repo, version, $updateChannel$);
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
      state = await requestUpdate(check.latest);
      updatingTo = check.latest;
      poll();
    } catch (e: any) {
      error = e.message;
    }
  }

  /** The stack restarts during the update, so failed requests just mean "wait". */
  async function poll() {
    try {
      state = await getUpdateState();
    } catch {
      // Restarting
    }

    // `finished` only updates after this function returns.
    const latest = state?.status;

    if (!(latest?.ref === updatingTo && latest.state !== 'running')) {
      pollTimer = setTimeout(poll, pollMs);
    }
  }

  function short(sha: string) {
    return sha.slice(0, 8);
  }
</script>

<p class="tool-text">
  Compares this server with the latest release (stable) or the newest commit on main (bleeding edge)
  of <a href="https://github.com/{repo}" target="_blank" rel="noreferrer">{repo}</a>. Updating
  downloads that version, rebuilds it on the server and restarts everything (about a minute of
  downtime; a running difficulty job stops).
</p>

<table class="app-table tool-table">
  <tbody>
    <tr>
      <th scope="row">Channel</th>
      <td>
        <span class="inline-block" role="group" aria-label="Update channel">
          <ButtonToggleGroup options={channelOptions} bind:selectedOptionId={$updateChannel$} />
        </span>
      </td>
    </tr>
    {#if checking}
      <tr>
        <th scope="row">Running</th>
        <td
          ><span class="flex items-center gap-2"
            ><Fa icon={faSpinner} spin /> Checking GitHub...</span
          ></td
        >
      </tr>
    {:else if check}
      <tr>
        <th scope="row">Running</th>
        <td>
          <code>{check.current ? short(check.current) : 'an unknown version'}</code>{check.dirty
            ? ' with local changes'
            : ''} ·
          {#if check.state === 'current'}
            the latest version
          {:else if check.state === 'behind'}
            <strong>{check.commits.length} newer commits</strong> in {check.target}
          {:else if check.state === 'ahead'}
            newer than {check.target} on GitHub
          {:else if check.state === 'diverged'}
            has commits that aren't in {check.target}
          {:else}
            a local build, not on GitHub
          {/if}
        </td>
      </tr>
      <tr>
        <th scope="row">Latest</th>
        <td>
          {#if check.target !== 'main'}{check.target} ·
          {/if}<code>{short(check.latest)}</code>
        </td>
      </tr>
    {/if}
    {#if state}
      <tr>
        <th scope="row">Updater</th>
        <td>
          {#if state.updater}
            <span class="tool-status" data-state="ok">Installed</span>
          {:else}
            <span class="tool-status" data-state="warn">
              Not installed: servers set up with scripts/deploy.sh get it (it needs systemd and an
              absolute DATA_PATH); otherwise update as described in docs/INSTALL.md.
            </span>
          {/if}
        </td>
      </tr>
    {/if}
    {#if status && !(updatingTo && !finished)}
      <tr>
        <th scope="row">{updatingTo ? 'Update' : 'Last update'}</th>
        <td>
          <span class="tool-status" data-state={status.state === 'failed' ? 'error' : 'ok'}>
            <span>
              {status.message} (<code>{short(status.ref)}</code>, {new Date(
                status.at * 1000
              ).toLocaleString()}).
              {#if finished && status.state === 'done'}
                <button
                  class="app-button app-button-quiet"
                  on:click={() => window.location.reload()}>Reload the page</button
                >
              {/if}
            </span>
          </span>
        </td>
      </tr>
    {/if}
  </tbody>
</table>

{#if check?.commits.length && !checking}
  <details class="tool-note">
    <summary class="cursor-pointer">Newer commits ({check.commits.length.toLocaleString()})</summary
    >
    <ul class="commit-list">
      {#each check.commits.slice(0, shownCommits) as commit (commit.sha)}
        <li><code>{short(commit.sha)}</code> {commit.message}</li>
      {/each}
      {#if check.commits.length > shownCommits}
        <li>... and {check.commits.length - shownCommits} more</li>
      {/if}
    </ul>
  </details>
{/if}

<div class="tool-actions">
  <button class="app-button" disabled={checking || !!updatingTo} on:click={refresh}>
    Check again
  </button>
  {#if canUpdate && !updatingTo && check}
    <button class="app-button app-button-primary" on:click={update}>
      Update to {check.target === 'main' ? short(check.latest) : check.target}
    </button>
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

{#if error}
  <p class="tool-error">{error}</p>
{/if}

<style>
  .commit-list {
    display: grid;
    max-height: 16rem;
    gap: 0.2rem;
    margin-top: 0.5rem;
    overflow-y: auto;
    padding-left: 1.1rem;
    list-style: disc;
  }
</style>
