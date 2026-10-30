<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import { inputClasses } from '$lib/css-classes';
  import {
    account$,
    accountConfig,
    accountUnreachable$,
    canOpenAdminPanel,
    changePassword,
    httpsAppUrl,
    isInsecurePage,
    isLoopbackPage,
    signIn,
    signInAvailableHere,
    signOut
  } from '$lib/data/account/account';
  import { settingsSyncState$, syncAccountSettings } from '$lib/data/account/account-settings-sync';
  import { pagePath } from '$lib/data/env';
  import { releaseReaderData } from '$lib/data/account/reader-data-owner';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  const minPasswordLength = 8;
  const insecure = isInsecurePage();
  const warnInsecure = insecure && !isLoopbackPage();
  const secureUrl = signInAvailableHere() ? '' : httpsAppUrl();

  /** HTTPS, or plain HTTP when the server allows it (checked on mount). */
  let available = signInAvailableHere();
  let checkingHttp = insecure;
  /** The first admin hasn't signed in yet: its password is on the server. */
  let initialAdmin = false;

  let busy = false;
  let error = '';
  let username = '';
  let password = '';
  let currentPassword = '';
  let newPassword = '';
  let passwordMessage = '';

  $: user = $account$;
  $: syncState = $settingsSyncState$;

  onMount(async () => {
    const config = await accountConfig();

    initialAdmin = config.initialAdmin;
    if (insecure) {
      available = config.httpAccounts;
      checkingHttp = false;
    }
  });

  /** Runs an action with the busy flag set; returns its error message, if any. */
  async function run(action: () => Promise<unknown>): Promise<string> {
    busy = true;

    try {
      await action();
      return '';
    } catch (e: any) {
      return e.message;
    } finally {
      busy = false;
    }
  }

  async function onSignIn() {
    // Reload afterwards so the library and reader load the account's data.
    error = await run(async () => {
      await signIn(username, password);
      window.location.reload();
    });
    password = '';
  }

  async function onSignOut() {
    error = await run(async () => {
      // While still signed in: the catalog names the titles whose progress to forget.
      await releaseReaderData(null, true).catch(() => {});
      await signOut();
      window.location.reload();
    });
  }

  async function onChangePassword() {
    const failure = await run(() => changePassword(currentPassword, newPassword));

    passwordMessage = failure || $t$('prefs.account.passwordChanged');

    if (!failure) {
      currentPassword = '';
      newPassword = '';
    }
  }

  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

{#if user}
  {#if warnInsecure}
    <p class="account-warning" role="alert">
      <strong>{$t$('prefs.account.notEncrypted')}</strong>
      {$t$('prefs.account.insecureSignedIn')}
      {$t$('prefs.account.useHttpsBefore')}
      <a class="font-semibold underline" href="{secureUrl}/settings?section=general#general-account"
        >{secureUrl.replace('https://', '')}</a
      >
      {$t$('prefs.account.useHttpsAfter')}
    </p>
  {/if}
  <div
    class="settings-item account-identity"
    data-settings-item
    data-settings-search="{$t$('prefs.account.signedIn')} {$t$('prefs.account.signOut')}"
  >
    <span class="account-avatar" aria-hidden="true">{user.username.charAt(0)}</span>
    <span class="account-name">{user.username}</span>
    <span class="account-sign-out">
      <button class="app-button" disabled={busy} on:click={onSignOut}>
        {$t$('prefs.account.signOut')}
      </button>
      {#if error}<span class="account-error">{error}</span>{/if}
    </span>
  </div>

  {#if user.temporaryPassword}
    <SettingsItemGroup title={$t$('prefs.account.tempPassword')} wide>
      <p class="account-warning" role="alert">
        {$t$('prefs.account.tempPasswordText')}
      </p>
    </SettingsItemGroup>
  {/if}

  {#if canOpenAdminPanel(user)}
    <SettingsItemGroup title={$t$('prefs.account.adminPanel')}>
      <a class="app-button app-button-primary" href="{pagePath}/admin">
        {$t$('prefs.account.open')}
      </a>
    </SettingsItemGroup>
  {/if}

  <SettingsItemGroup
    title={$t$('prefs.account.settingsSync')}
    tooltip={syncState.state === 'syncing'
      ? $t$('prefs.account.syncing')
      : syncState.state === 'synced'
        ? $t$('prefs.account.syncedAt', { time: formatTime(syncState.at) })
        : syncState.state === 'error'
          ? syncState.message
          : $t$('prefs.account.notStarted')}
  >
    <button
      class="app-button app-button-quiet"
      disabled={syncState.state === 'syncing'}
      on:click={syncAccountSettings}
    >
      {$t$('prefs.account.syncNow')}
    </button>
  </SettingsItemGroup>

  <SettingsItemGroup
    title={$t$('prefs.account.changePassword')}
    tooltip={$t$('prefs.account.changePasswordHint', { count: minPasswordLength })}
    wide
  >
    <form class="account-password" on:submit|preventDefault={onChangePassword}>
      <input type="text" autocomplete="username" value={user.username} hidden readonly />
      <label class="account-field">
        <span>{$t$('prefs.account.currentPassword')}</span>
        <input
          type="password"
          autocomplete="current-password"
          required
          class={inputClasses}
          bind:value={currentPassword}
        />
      </label>
      <label class="account-field">
        <span>{$t$('prefs.account.newPassword')}</span>
        <input
          type="password"
          autocomplete="new-password"
          minlength={minPasswordLength}
          required
          class={inputClasses}
          bind:value={newPassword}
        />
      </label>
      <button class="app-button" disabled={busy}>{$t$('prefs.account.change')}</button>
    </form>
    {#if passwordMessage}<p class="mt-2 text-sm" role="status">{passwordMessage}</p>{/if}
  </SettingsItemGroup>
{:else if user === undefined}
  <p class="account-checking">{$t$('prefs.account.checking')}</p>
{:else if $accountUnreachable$}
  <p class="account-warning" role="status">{$t$('prefs.account.unreachable')}</p>
{:else}
  <div
    class="settings-item account-sign-in"
    data-settings-item
    data-settings-search={$t$('nav.signIn')}
  >
    {#if checkingHttp}
      <p class="account-checking">{$t$('prefs.account.checking')}</p>
    {:else if available}
      {#if warnInsecure}
        <p class="account-warning" role="alert">
          <strong>{$t$('prefs.account.notEncrypted')}</strong>
          {$t$('prefs.account.insecureSignIn')}
          {$t$('prefs.account.signInAtBefore')}
          <a
            class="font-semibold underline"
            href="{secureUrl}/settings?section=general#general-account"
            >{secureUrl.replace('https://', '')}</a
          >
          {$t$('prefs.account.signInAtAfter')}
        </p>
      {/if}
      {#if initialAdmin}
        <p class="account-intro">
          <strong>{$t$('prefs.account.firstStart')}</strong>
          {$t$('prefs.account.firstStartBefore')} <code>admin</code>
          {$t$('prefs.account.firstStartMiddle')}
          <code>ebook-account initial-admin</code>
          {$t$('prefs.account.firstStartOr')} <code>docker compose logs account</code>{$t$(
            'prefs.account.firstStartAfter'
          )}
        </p>
      {/if}
      <form class="account-form" on:submit|preventDefault={onSignIn}>
        <label class="account-field">
          <span>{$t$('prefs.username')}</span>
          <input
            type="text"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            placeholder={$t$('prefs.username')}
            required
            class={inputClasses}
            bind:value={username}
          />
        </label>
        <label class="account-field">
          <span>{$t$('prefs.password')}</span>
          <input
            type="password"
            autocomplete="current-password"
            placeholder={$t$('prefs.password')}
            required
            class={inputClasses}
            bind:value={password}
          />
        </label>
        <p class="account-submit">
          <button class="app-button app-button-primary" disabled={busy}>
            {$t$('nav.signIn')}
          </button>
          <span class="account-meta">{$t$('prefs.account.signInHint')}</span>
        </p>
      </form>
      {#if error}<p class="account-error">{error}</p>{/if}
    {:else}
      <p class="text-sm">
        {$t$('prefs.account.secureOnlyBefore')}
        <a
          class="font-semibold underline"
          href="{secureUrl}/settings?section=general#general-account"
          >{secureUrl.replace('https://', '')}</a
        >
        {$t$('prefs.account.secureOnlyAfter')}
      </p>
    {/if}
  </div>
{/if}

<style>
  /* Rows built here (not with SettingsItemGroup) share its rule and spacing. */
  .settings-item {
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
    scroll-margin-top: 6rem;
  }

  .account-identity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
  }

  .account-name {
    min-width: 0;
    flex: 1 1 10rem;
    overflow: hidden;
    font-size: var(--type-body);
    text-overflow: ellipsis;
  }

  .account-meta {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .account-avatar {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: var(--font-color);
    color: var(--background-color);
    font-size: var(--type-body);
    font-weight: 700;
    text-transform: uppercase;
  }

  .account-sign-out {
    display: grid;
    justify-items: end;
    gap: 0.35rem;
    margin-left: auto;
    text-align: right;
  }

  .account-intro {
    max-width: 38rem;
    margin-bottom: 1.25rem;
    line-height: 1.65;
  }

  .account-form {
    display: grid;
    max-width: 22.5rem;
    gap: 1rem;
  }

  .account-field {
    display: grid;
    min-width: 0;
    gap: 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .account-field input {
    width: 100%;
    color: var(--font-color);
  }

  .account-submit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    width: max-content;
    max-width: 100%;
  }

  .account-password {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .account-password .account-field {
    flex: 0 1 16rem;
  }

  .account-checking {
    padding: 1rem 0;
    color: var(--app-muted-fg);
  }

  .account-warning {
    margin: 1rem 0 0.25rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--app-warning-color);
    border-radius: 2px;
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .account-error {
    margin-top: 0.5rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  @media (max-width: 639px) {
    .account-sign-out {
      justify-items: start;
      margin-left: 0;
      text-align: left;
    }
  }
</style>
