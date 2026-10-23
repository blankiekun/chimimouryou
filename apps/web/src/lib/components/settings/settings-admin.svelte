<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import AdminSection from '$lib/components/admin/admin-section.svelte';
  import {
    accountPermissions,
    addAccount,
    listAccounts,
    removeAccount,
    resetAccountPassword,
    setAccountAdmin,
    setAccountPermissions,
    type AccountPermission,
    type AccountUser,
    type AdminAccount
  } from '$lib/data/account';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  /** The signed-in admin. */
  export let self: AccountUser;

  const minPasswordLength = 8;

  let accounts: AdminAccount[] = [];
  let loading = true;
  let busy = false;
  let message = '';
  let error = '';
  let newUsername = '';
  let newPassword = '';
  let newAdmin = false;
  /** Username whose password is being reset. */
  let resetting = '';
  let resetPassword = '';

  onMount(refresh);

  async function refresh() {
    try {
      accounts = await listAccounts();
      error = '';
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  /** Runs an admin action, shows its result and reloads the list. */
  async function run(action: () => Promise<unknown>, done: string) {
    busy = true;
    message = '';

    try {
      await action();
      error = '';
      message = done;
      await refresh();
      return true;
    } catch (e: any) {
      error = e.message;
      return false;
    } finally {
      busy = false;
    }
  }

  async function onAdd() {
    const username = newUsername.trim().toLowerCase();

    if (await run(() => addAccount(username, newPassword, newAdmin), `Added ${username}.`)) {
      newUsername = '';
      newPassword = '';
      newAdmin = false;
    }
  }

  async function onReset() {
    const username = resetting;

    if (
      await run(
        () => resetAccountPassword(username, resetPassword),
        `Changed the password of ${username} and signed out its devices.`
      )
    ) {
      resetting = '';
      resetPassword = '';
    }
  }

  function onToggleAdmin(account: AdminAccount) {
    run(
      () => setAccountAdmin(account.username, !account.admin),
      `${account.username} is ${account.admin ? 'no longer' : 'now'} an admin.`
    );
  }

  function onTogglePermission(account: AdminAccount, permission: AccountPermission) {
    const granted = account.permissions || [];
    const allowed = !granted.includes(permission);
    const label = accountPermissions.find(({ id }) => id === permission)?.label;

    run(
      () =>
        setAccountPermissions(
          account.username,
          allowed ? [...granted, permission] : granted.filter((name) => name !== permission)
        ),
      `${label}: ${allowed ? 'allowed' : 'no longer allowed'} for ${account.username}.`
    );
  }

  function onRemove(account: AdminAccount) {
    if (
      window.confirm(
        `Remove ${account.username}? They are signed out everywhere. Their reading data stays on the server.`
      )
    ) {
      run(() => removeAccount(account.username), `Removed ${account.username}.`);
    }
  }

  /** YYYY-MM-DD in local time */
  function formatDate(seconds: number) {
    return new Date(seconds * 1000).toLocaleDateString('sv-SE');
  }
</script>

<AdminSection
  number={1}
  title="Manage accounts"
  count={loading ? undefined : accounts.length}
  description="Only admins see this. Set what each account may do under User permissions."
>
  {#if loading}
    <span class="flex items-center gap-2"><Fa icon={faSpinner} spin /> Loading accounts...</span>
  {:else}
    <table class="app-table admin-accounts">
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col">Since</th>
          <th scope="col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each accounts as account (account.id)}
          <tr>
            <td class="admin-name">
              {account.username}
              {#if account.admin}<span class="admin-badge">admin</span>{/if}
            </td>
            <td class="admin-since">{formatDate(account.created)}</td>
            <td class="admin-actions">
              <button
                class="app-button"
                disabled={busy}
                aria-expanded={resetting === account.username}
                on:click={() => {
                  resetting = resetting === account.username ? '' : account.username;
                  resetPassword = '';
                }}>Reset password</button
              >
              <button
                class="app-button"
                disabled={busy || account.id === self.id}
                title={account.id === self.id ? 'You cannot remove your own account' : ''}
                on:click={() => onRemove(account)}>Remove</button
              >
            </td>
          </tr>
          {#if resetting === account.username}
            <tr>
              <td colspan="3">
                <form class="admin-reset" on:submit|preventDefault={onReset}>
                  <input
                    type="text"
                    autocomplete="username"
                    value={account.username}
                    hidden
                    readonly
                  />
                  <input
                    type="password"
                    autocomplete="new-password"
                    placeholder="New password for {account.username}"
                    aria-label="New password for {account.username}"
                    minlength={minPasswordLength}
                    required
                    class="app-input"
                    bind:value={resetPassword}
                  />
                  <button class="app-button" disabled={busy}>Set password</button>
                </form>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>

    <form class="admin-add" on:submit|preventDefault={onAdd}>
      <p class="admin-add-label">Add account</p>
      <div class="admin-add-fields">
        <input
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder="New username"
          aria-label="New username"
          pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{'{'}2,31{'}'}"
          title="3-32 characters: letters, digits, '.', '_' and '-'"
          required
          class="app-input"
          bind:value={newUsername}
        />
        <input
          type="password"
          autocomplete="new-password"
          placeholder="Password"
          aria-label="Password for the new account"
          minlength={minPasswordLength}
          required
          class="app-input"
          bind:value={newPassword}
        />
        <label class="admin-check">
          <input type="checkbox" bind:checked={newAdmin} />
          Admin
        </label>
        <button class="app-button app-button-primary" disabled={busy}>Add account</button>
      </div>
      <p class="admin-hint">
        3-32 characters: letters, digits, '.', '_' and '-'. Passwords need at least {minPasswordLength}.
      </p>
    </form>
  {/if}
  {#if message}<p class="admin-message" role="status">{message}</p>{/if}
  {#if error}<p class="admin-error" role="alert">{error}</p>{/if}
</AdminSection>

{#if !loading && accounts.length}
  <AdminSection
    number={2}
    title="User permissions"
    description="What each account may do besides reading. Admins have every permission and manage accounts. Changes apply on the account's next page load."
  >
    <div class="overflow-x-auto">
      <table class="app-table permissions-table">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" title="Manage accounts; has every permission">Admin</th>
            {#each accountPermissions as permission (permission.id)}
              <th scope="col" title={permission.description}>{permission.label}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each accounts as account (account.id)}
            <tr>
              <th scope="row">{account.username}</th>
              <td>
                <input
                  type="checkbox"
                  aria-label="{account.username} is an admin"
                  title={account.id === self.id ? 'Another admin has to change this' : ''}
                  checked={!!account.admin}
                  disabled={busy || account.id === self.id}
                  on:click|preventDefault={() => onToggleAdmin(account)}
                />
              </td>
              {#each accountPermissions as permission (permission.id)}
                <td>
                  <input
                    type="checkbox"
                    aria-label="{account.username}: {permission.description}"
                    title={account.admin ? 'Admins have every permission' : permission.description}
                    checked={!!account.admin || !!account.permissions?.includes(permission.id)}
                    disabled={busy || !!account.admin}
                    on:click|preventDefault={() => onTogglePermission(account, permission.id)}
                  />
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <ul class="admin-legend">
      {#each accountPermissions as permission (permission.id)}
        <li>{permission.label}: {permission.description}</li>
      {/each}
    </ul>
  </AdminSection>
{/if}

<style>
  .admin-name {
    font-weight: 700;
  }

  .admin-since {
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .admin-actions {
    text-align: right;
    white-space: nowrap;
  }

  .admin-actions button + button {
    margin-left: 0.6rem;
  }

  .admin-badge {
    margin-left: 0.4rem;
    padding: 0 0.35rem;
    border: 1px solid var(--accent-color);
    border-radius: 2px;
    color: var(--accent-strong-color);
    font-size: var(--type-label);
    font-weight: 400;
  }

  .admin-reset {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .admin-reset input {
    width: 19rem;
    max-width: 100%;
  }

  .admin-add {
    margin-top: 1.5rem;
  }

  .admin-add-label {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .admin-add-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.4rem;
  }

  .admin-add-fields .app-input {
    width: 15rem;
    max-width: 100%;
  }

  .admin-check {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .admin-hint,
  .admin-legend {
    margin-top: 0.6rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .admin-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.5rem;
    margin-top: 1rem;
  }

  .admin-message {
    margin-top: 0.75rem;
    font-size: var(--type-small);
  }

  .admin-error {
    margin-top: 0.75rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .permissions-table th[scope='row'] {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
  }

  @media (max-width: 639px) {
    .admin-accounts thead {
      display: none;
    }

    .admin-accounts tr {
      display: grid;
      grid-template-columns: 1fr auto;
    }

    .admin-accounts .admin-actions {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
