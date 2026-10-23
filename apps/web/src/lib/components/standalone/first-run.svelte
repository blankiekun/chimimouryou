<script lang="ts">
  /**
   * Standalone first run (plan S1): where books live, before Home. The choice becomes
   * `storageSource$`; Settings → Sync changes it later.
   */
  import { browser } from '$app/environment';
  import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { storageRootName } from '$lib/data/env';
  import {
    chooseStorage,
    driveAvailable,
    driveEmail$,
    driveSignedIn,
    folderAvailable,
    pickFolder,
    signInToDrive,
    storageChosen$
  } from '$lib/data/standalone-storage';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { isOnline$ } from '$lib/data/store';
  import { isMobile } from '$lib/functions/utils';
  import Fa from 'svelte-fa';

  const yomitan = {
    chrome: 'https://chromewebstore.google.com/detail/yomitan/likgccmbimhjbgkjambclfkhldnlhbnn',
    edge: 'https://microsoftedge.microsoft.com/addons/detail/yomitan/idelnfbbmikgfiejhgmddlbkfgiifnnn',
    firefox: 'https://addons.mozilla.org/firefox/addon/yomitan/'
  };

  const hasDrive = browser && driveAvailable(window);
  // Phones can't pick folders (and the plan keeps the folder for desktops).
  const hasFolder = browser && folderAvailable(window) && !isMobile(window);

  let selected = StorageKey.BROWSER;
  let morePlaces = false;
  let signingIn = false;
  let driveError = '';
  let folderName = '';
  let folderError = '';
  let signedIn = driveSignedIn();

  $: offline = !$isOnline$;
  $: if (offline && selected === StorageKey.GDRIVE && !signedIn) selected = StorageKey.BROWSER;

  async function selectDrive() {
    selected = StorageKey.GDRIVE;
    if (signedIn) return;
    driveError = '';
    signingIn = true;
    const error = await signInToDrive(window);
    signingIn = false;
    signedIn = driveSignedIn();
    driveError =
      error === 'blocked'
        ? 'The sign-in window was blocked. Allow pop-ups for this site, then try again.'
        : error;
  }

  async function selectFolder() {
    const previous = selected;
    selected = StorageKey.FS;
    folderError = '';
    try {
      folderName = (await pickFolder(window)) || folderName;
    } catch (error: any) {
      folderError = error.message;
    }
    if (!folderName) selected = previous;
  }

  function finish() {
    chooseStorage(window, selected);
    storageChosen$.next(true);
  }

  $: driveStatus = offline
    ? 'Needs a connection'
    : signingIn
      ? 'Signing in…'
      : signedIn
        ? $driveEmail$
          ? `Signed in as ${$driveEmail$}`
          : 'Signed in'
        : selected === StorageKey.GDRIVE
          ? 'Not signed in'
          : 'Google sign-in';
</script>

<div class="app-page-shell">
  <AppHeader active={undefined} bare />

  <div class="first-run">
    <main class="first-run-main" aria-labelledby="first-run-title">
      <SectionHead id="first-run-title" number={1} title="Where your books live" level="h1" />
      <p class="first-run-intro">
        {offline
          ? 'You are offline. Keep books on this device for now; sync can be turned on later in Settings → Sync.'
          : 'Choose where your books and reading progress are kept. You can change this later in Settings → Sync.'}
      </p>

      <div class="places" role="radiogroup" aria-labelledby="first-run-title">
        <label class="place" class:place-selected={selected === StorageKey.BROWSER}>
          <input
            type="radio"
            name="storage"
            checked={selected === StorageKey.BROWSER}
            on:change={() => (selected = StorageKey.BROWSER)}
          />
          <span class="place-text">
            <span class="place-title">This device</span>
            <span class="place-description">Books stay in this browser. Nothing leaves it.</span>
          </span>
          <span class="place-status">No sign-in</span>
        </label>

        {#if hasDrive}
          <div
            class="place-group"
            class:place-selected={selected === StorageKey.GDRIVE}
            class:place-disabled={offline}
          >
            <label class="place">
              <input
                type="radio"
                name="storage"
                disabled={offline}
                checked={selected === StorageKey.GDRIVE}
                on:change={selectDrive}
              />
              <span class="place-text">
                <span class="place-title">Google Drive</span>
                <span class="place-description">
                  Sync across devices through your Drive, in a {storageRootName} folder.
                </span>
              </span>
              <span class="place-status" class:place-status-strong={signedIn}>{driveStatus}</span>
            </label>
            {#if driveError && selected === StorageKey.GDRIVE}
              <div class="place-error" role="alert">
                <p>{driveError}</p>
                <button type="button" class="app-button app-button-quiet" on:click={selectDrive}>
                  Try again
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if hasFolder && morePlaces}
          <div class="place-group" class:place-selected={selected === StorageKey.FS}>
            <label class="place">
              <input
                type="radio"
                name="storage"
                checked={selected === StorageKey.FS}
                on:click|preventDefault={selectFolder}
              />
              <span class="place-text">
                <span class="place-title">A folder on this computer</span>
                <span class="place-description">
                  Books and progress go to a folder you pick, such as one your own cloud app syncs.
                  Chrome and Edge.
                </span>
              </span>
              <span class="place-status">{folderName ? folderName : 'Pick a folder'}</span>
            </label>
            {#if folderError}
              <div class="place-error" role="alert"><p>{folderError}</p></div>
            {/if}
          </div>
        {/if}
      </div>

      {#if hasFolder}
        <button
          type="button"
          class="app-button app-button-quiet first-run-more"
          aria-expanded={morePlaces}
          on:click={() => (morePlaces = !morePlaces)}
        >
          {morePlaces ? 'Fewer places' : 'More places'}
          <Fa icon={morePlaces ? faCaretUp : faCaretDown} size="xs" />
        </button>
      {/if}

      <button
        type="button"
        class="app-button app-button-primary first-run-continue"
        on:click={finish}
      >
        Continue
      </button>
    </main>

    <aside class="first-run-aside">
      <PointBox label="Lookups">
        <div class="lookups lookups-desktop">
          <p>Install Yomitan in this browser to look up words as you read.</p>
          <p class="lookups-links">
            <a href={yomitan.chrome} target="_blank" rel="noreferrer">Chrome</a>
            <a href={yomitan.edge} target="_blank" rel="noreferrer">Edge</a>
            <a href={yomitan.firefox} target="_blank" rel="noreferrer">Firefox</a>
          </p>
          <p class="lookups-note">On Android, Yomitan runs in Firefox.</p>
        </div>
        <div class="lookups lookups-phone">
          <p>Install Yomitan to look up words as you read. On Android it runs in Firefox.</p>
          <p class="lookups-links">
            <a href={yomitan.firefox} target="_blank" rel="noreferrer">Yomitan for Firefox</a>
          </p>
          <p class="lookups-note">Safari on iPhone and iPad has no Yomitan.</p>
        </div>
      </PointBox>
    </aside>
  </div>
</div>

<style>
  .first-run {
    display: grid;
    max-width: 80rem;
    grid-template-columns: minmax(0, 47.5rem) minmax(0, 22.5rem);
    justify-content: space-between;
    gap: 3rem;
    margin: 0 auto;
    padding: 6.75rem clamp(1rem, 3.125vw, 2.5rem) 4rem;
  }

  .first-run-intro {
    max-width: 48rem;
    margin: 1.25rem 0 1.5rem;
    color: var(--font-color);
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .places {
    border-top: 2px solid var(--font-color);
  }

  .place-group,
  .places > .place {
    border-bottom: 1px solid var(--border-color);
  }

  .place {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.25rem 1rem;
    padding: 1rem 1rem 1rem 1rem;
    cursor: pointer;
  }

  .place-selected {
    background: color-mix(in srgb, var(--accent-color) 10%, var(--background-color));
    box-shadow: inset 3px 0 0 var(--accent-color);
  }

  .place-disabled .place {
    cursor: not-allowed;
  }

  .place-disabled .place-title,
  .place-disabled .place-description {
    color: var(--app-muted-fg);
  }

  /* Drawn from theme colours: the native radio stays white on dark themes. */
  .place input {
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
    appearance: none;
    border: 1.5px solid var(--app-muted-fg);
    border-radius: 50%;
    background: var(--background-color);
  }

  .place input:checked {
    border-color: var(--accent-color);
    background: var(--accent-color);
    box-shadow: inset 0 0 0 3px var(--background-color);
  }

  .place input:disabled {
    opacity: 0.5;
  }

  .place input:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .place-text {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  .place-title {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
  }

  .place-description {
    max-width: 32rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .place-status {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-align: right;
  }

  .place-status-strong {
    color: var(--font-color);
  }

  .place-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 2rem;
    padding: 0 1rem 1rem 3.25rem;
  }

  .place-error p {
    max-width: 32rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .first-run-more {
    margin: 1rem 0 0 1rem;
    font-size: var(--type-small);
  }

  .first-run-continue {
    display: flex;
    margin-top: 1.75rem;
  }

  .lookups {
    display: grid;
    gap: 1rem;
    color: var(--font-color);
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .lookups-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
  }

  .lookups-links a {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .lookups-links a:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .lookups-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .lookups-phone {
    display: none;
  }

  @media (max-width: 900px) {
    .first-run {
      grid-template-columns: minmax(0, 1fr);
      gap: 2rem;
      padding-top: 5.5rem;
    }
  }

  @media (max-width: 639px) {
    .place {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
    }

    .place input {
      margin-top: 0.15rem;
    }

    .place-status {
      grid-column: 2;
      text-align: left;
    }

    .place-error {
      padding-left: 3.25rem;
    }

    .first-run-continue {
      width: 100%;
    }

    .lookups-desktop {
      display: none;
    }

    .lookups-phone {
      display: grid;
    }
  }
</style>
