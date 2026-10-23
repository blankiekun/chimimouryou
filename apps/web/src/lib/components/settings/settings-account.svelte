<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import { inputClasses } from '$lib/css-classes';
  import {
    account$,
    accountConfig,
    canOpenAdminPanel,
    changePassword,
    httpsAppUrl,
    isInsecurePage,
    isLoopbackPage,
    signIn,
    signInAvailableHere,
    signOut
  } from '$lib/data/account';
  import {
    readerProfile,
    settingsSyncState$,
    syncAccountSettings
  } from '$lib/data/account-settings-sync';
  import { pagePath } from '$lib/data/env';
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

  $: profileLabel =
    available || $account$
      ? $t$(readerProfile() === 'phone' ? 'prefs.account.phone' : 'prefs.account.desktop')
      : '';

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
    data-settings-search="{$t$('prefs.account.signedIn')} {$t$('prefs.account.signOut')} {$t$(
      'prefs.account.signOutHint'
    )}"
  >
    <span class="account-avatar" aria-hidden="true">{user.username.charAt(0)}</span>
    <span class="account-identity-text">
      <span class="account-name">{user.username}</span>
      <span class="account-meta">
        {$t$(user.admin ? 'prefs.account.identityAdmin' : 'prefs.account.identity', {
          profile: profileLabel
        })}
      </span>
    </span>
    <span class="account-sign-out">
      <button class="app-button" disabled={busy} on:click={onSignOut}>
        {$t$('prefs.account.signOut')}
      </button>
      <span class="account-meta">{$t$('prefs.account.signOutHint')}</span>
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
    <SettingsItemGroup
      title={$t$('prefs.account.adminPanel')}
      tooltip={$t$('prefs.account.adminPanelHint')}
    >
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

  <div
    class="settings-item account-syncs"
    data-settings-item
    data-settings-search={$t$('prefs.account.whatSyncs')}
  >
    <h3>{$t$('prefs.account.whatSyncs')}</h3>
    <table class="app-table">
      <tbody>
        <tr>
          <th scope="row">{$t$('prefs.account.syncsProgressLabel')}</th>
          <td>{$t$('prefs.account.syncsProgress')}</td>
        </tr>
        <tr>
          <th scope="row">{$t$('prefs.account.syncsAiLabel')}</th>
          <td>{$t$('prefs.account.syncsAi')}</td>
        </tr>
        <tr>
          <th scope="row">{$t$('prefs.account.syncsReaderLabel')}</th>
          <td>{$t$('prefs.account.syncsReader', { profile: profileLabel })}</td>
        </tr>
      </tbody>
    </table>
    <p class="account-meta">{$t$('prefs.account.syncsWhere')}</p>
  </div>

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
{:else}
  <div
    class="settings-item account-sign-in"
    data-settings-item
    data-settings-search="{$t$('nav.signIn')} {$t$('prefs.account.signInHint')}"
  >
    <p class="account-intro">{$t$('prefs.account.signInHint')}</p>
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
          <span class="account-meta">{$t$('prefs.account.remember')}</span>
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

  .account-identity-text {
    display: grid;
    min-width: 0;
    flex: 1 1 14rem;
  }

  .account-name {
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

  .account-syncs h3 {
    padding-bottom: 0.75rem;
    font-size: var(--type-body);
  }

  .account-syncs th {
    width: 12rem;
    color: var(--font-color);
    font-size: var(--type-body);
    vertical-align: top;
  }

  .account-syncs td,
  .account-syncs th {
    padding-block: 0.8rem;
    line-height: 1.55;
  }

  .account-syncs .account-meta {
    max-width: 40rem;
    margin-top: 0.75rem;
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
    .account-syncs th {
      width: 7rem;
    }

    .account-sign-out {
      justify-items: start;
      margin-left: 0;
      text-align: left;
    }
  }
</style>
