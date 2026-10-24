<script lang="ts">
  /**
   * Standalone first run (plan S1): where books live, before Home. The choice becomes
   * `storageSource$`; Settings → Sync changes it later. Where the analysis tools run, it offers them
   * and the Generated furigana switch; a download started here carries on after it closes.
   */
  import { browser } from '$app/environment';
  import { faCaretDown, faCaretUp } from '@fortawesome/free-solid-svg-icons';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import SocialAccountForm from '$lib/components/social/social-account-form.svelte';
  import { socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import { pagePath, storageRootName } from '$lib/data/env';
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
  import { generatedFurigana$, isOnline$ } from '$lib/data/store';
  import {
    analysisDownload$,
    analysisFeatures,
    analysisToolsSize,
    analysisToolsState$,
    analysisToolsSupported,
    checkAnalysisTools,
    downloadAnalysisTools,
    type AnalysisFeature
  } from '$lib/data/analysis-tools';
  import { onMount } from 'svelte';
  import { yomitanSeen$ } from '$lib/data/yomitan';
  import { builtInLookups$, builtInLookupsChoice$ } from '$lib/data/dictionary';
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

  const toolsSupported = browser && analysisToolsSupported();
  const mb = (bytes: number) => Math.round(bytes / 1e6).toLocaleString('en-US');
  let toolsSize: number | undefined;
  let toolsDeclined = false;

  let wantDifficulty = true;

  // Only the features switched on are fetched (the furigana switch is the reader setting itself).
  $: wantedTools = analysisFeatures.filter((feature) =>
    feature === 'furigana' ? $generatedFurigana$ : wantDifficulty
  );
  $: toolsReady =
    !!wantedTools.length &&
    wantedTools.every((feature) => $analysisToolsState$[feature] === 'ready');
  $: toolsDownloading = !!$analysisDownload$ && !$analysisDownload$.error;
  $: if (toolsSupported && !toolsDownloading) measureTools(wantedTools);
  $: toolsShown = toolsSupported && (toolsSize !== undefined || toolsReady || toolsDownloading);

  // Friends (the social plugin): nothing goes to the hub until Sign up or Log in is sent.
  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  let socialForm: 'signup' | 'login' | undefined;
  let socialDeclined = false;

  onMount(() => {
    if (toolsSupported) checkAnalysisTools();
  });

  async function measureTools(features: AnalysisFeature[]) {
    // Nothing chosen: no size, and Download is off.
    const size = features.length
      ? await analysisToolsSize(features).catch(() => undefined)
      : (toolsSize ?? 0);

    if (features === wantedTools) toolsSize = size;
  }

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

<div class="app-page-shell first-run-page">
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

      {#if toolsShown}
        <section class="tools" aria-labelledby="first-run-tools-title">
          <SectionHead id="first-run-tools-title" number={2} title="Analysis tools" />
          <p class="first-run-intro">
            Optional downloads that run in this browser: a difficulty estimate and a word list for
            each book, and furigana on words the book gives none. Books are analysed in the
            background after you add them.
          </p>

          <div class="tools-rows">
            <div class="tool-row">
              <span class="place-text">
                <span class="place-title" id="first-run-difficulty">
                  {$t$('firstRun.difficulty')}
                </span>
                <span class="place-description">{$t$('firstRun.difficultyHint')}</span>
              </span>
              <button
                type="button"
                role="switch"
                class="app-switch"
                aria-checked={wantDifficulty}
                aria-labelledby="first-run-difficulty"
                disabled={toolsDownloading}
                on:click={() => (wantDifficulty = !wantDifficulty)}
              >
                <span class="app-switch-thumb" />
              </button>
            </div>
            <div class="tool-row">
              <span class="place-text">
                <span class="place-title" id="first-run-furigana">Generated furigana</span>
                <span class="place-description">
                  Turn it off any time in Settings → Reader. Readings by
                  <a href="https://github.com/blankiekun/yurigana" target="_blank" rel="noreferrer"
                    >yurigana</a
                  >.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                class="app-switch"
                aria-checked={$generatedFurigana$}
                aria-labelledby="first-run-furigana"
                on:click={() => generatedFurigana$.next(!$generatedFurigana$)}
              >
                <span class="app-switch-thumb" />
              </button>
            </div>
          </div>

          {#if toolsReady}
            <p class="tools-note">Downloaded. Books you add are analysed in the background.</p>
          {:else if toolsDownloading}
            {@const total = $analysisDownload$?.total ?? 0}
            {@const done = $analysisDownload$?.done ?? 0}
            <div
              class="tools-track"
              role="progressbar"
              aria-label="Downloading the analysis tools"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
            >
              <div class="tools-fill" style:width="{total ? (done / total) * 100 : 0}%" />
            </div>
            <p class="tools-note">
              {mb(done)} of {total ? mb(total) : '…'} MB. The download carries on after you continue;
              Settings → Analysis tools shows it.
            </p>
          {:else if toolsDeclined}
            <p class="tools-note">You can download them later in Settings → Analysis tools.</p>
          {:else}
            {#if $analysisDownload$?.error}
              <p class="tools-note tools-error" role="alert">
                The download failed: {$analysisDownload$.error}
              </p>
            {/if}
            <span class="tools-actions">
              <button
                type="button"
                class="app-button app-button-primary"
                disabled={!wantedTools.length}
                on:click={() => downloadAnalysisTools(wantedTools)}
              >
                Download{toolsSize && wantedTools.length ? ` (${mb(toolsSize)} MB)` : ''}
              </button>
              <button
                type="button"
                class="app-button app-button-quiet"
                on:click={() => (toolsDeclined = true)}
              >
                Not now
              </button>
            </span>
          {/if}
        </section>
      {/if}

      <section class="lookups-step" aria-labelledby="first-run-lookups-title">
        <SectionHead
          id="first-run-lookups-title"
          number={toolsShown ? 3 : 2}
          title={$t$('firstRun.lookups')}
        />
        <p class="first-run-intro">{$t$('firstRun.lookupsLead')}</p>
        <div class="tools-rows">
          <div class="tool-row">
            <span class="place-text">
              <span class="place-title" id="first-run-lookups">{$t$('firstRun.lookupsSwitch')}</span
              >
              {#if !$yomitanSeen$}
                <!-- Looking it up with Yomitan shows its popup: watchYomitan turns the switch off. -->
                <span class="place-description">
                  {$t$('firstRun.lookupsTest')} <span class="lookups-word" lang="ja">辞書</span>
                </span>
              {/if}
            </span>
            <button
              type="button"
              role="switch"
              class="app-switch"
              aria-checked={$builtInLookups$}
              aria-labelledby="first-run-lookups"
              on:click={() => builtInLookupsChoice$.next(!$builtInLookups$)}
            >
              <span class="app-switch-thumb" />
            </button>
          </div>
        </div>
        <a class="first-run-server" href="{pagePath}/settings?section=dictionary">
          {$t$('firstRun.lookupsSettings')}
        </a>
      </section>

      {#if socialOn}
        <section class="social" aria-labelledby="first-run-social-title">
          <SectionHead
            id="first-run-social-title"
            number={toolsShown ? 4 : 3}
            title={$t$('social.friends')}
          />
          <p class="first-run-intro">{$t$('social.firstRunLead')}</p>
          {#if $socialSession$ && !socialForm}
            <p class="tools-note" role="status">
              {$t$('social.firstRunSignedIn', { name: $socialSession$.me.username })}
            </p>
          {:else if socialForm}
            <SocialAccountForm mode={socialForm} compact on:done={() => (socialForm = undefined)} />
          {:else if socialDeclined}
            <p class="tools-note">{$t$('social.firstRunLater')}</p>
          {:else}
            <span class="tools-actions">
              <button
                type="button"
                class="app-button app-button-primary"
                on:click={() => (socialForm = 'signup')}
              >
                {$t$('social.signUp')}
              </button>
              <button
                type="button"
                class="app-button app-button-quiet"
                on:click={() => (socialForm = 'login')}
              >
                {$t$('social.logIn')}
              </button>
              <button
                type="button"
                class="app-button app-button-quiet"
                on:click={() => (socialDeclined = true)}
              >
                {$t$('social.notNow')}
              </button>
            </span>
          {/if}
        </section>
      {/if}

      <button
        type="button"
        class="app-button app-button-primary first-run-continue"
        on:click={finish}
      >
        Continue
      </button>
      {#if $isOnline$}
        <a class="first-run-server" href="{pagePath}/settings?section=sync#sync-server">
          I have a chimimouryou server
        </a>
      {/if}
    </main>

    {#if !$yomitanSeen$}
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
    {/if}
  </div>
</div>

<style>
  /* Covers the library page under it (routes/manage) until a place is chosen. */
  .first-run-page {
    position: fixed;
    inset: 0;
    z-index: 45;
    overflow-y: auto;
    background: var(--background-color);
  }

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
    background: var(--app-spot-tint);
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

  .tools,
  .lookups-step,
  .social {
    margin-top: 3rem;
  }

  .tools-rows {
    border-top: 2px solid var(--font-color);
  }

  .tool-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .tool-row a {
    color: var(--accent-strong-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .tools-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }

  .tools-track {
    height: 3px;
    margin-top: 1.25rem;
    background: var(--app-progress-track);
  }

  .tools-fill {
    height: 100%;
    background: var(--app-progress-fill);
  }

  .tools-note {
    margin-top: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
  }

  .tools-error {
    color: var(--app-danger-color);
  }

  .first-run-server {
    display: inline-block;
    margin-top: 1.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .first-run-server:hover {
    color: var(--font-color);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .lookups-word {
    color: var(--font-color);
    font-size: var(--type-h2);
    font-weight: 700;
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
