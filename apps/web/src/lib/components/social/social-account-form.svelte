<script lang="ts">
  import RecoveryCode from '$lib/components/social/recovery-code.svelte';
  import { hubErrorKey, hubOrigin, logIn, recoverAccount, signUp } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /**
   * Friends on first open (boards 03, 04, 06): sign up or log in to the hub, the recovery code
   * shown once, and Forgot password with the recovery code.
   */
  export let mode: 'signup' | 'login' | 'forgot' = 'signup';
  /** Under a heading of its own (the first run): no title or lead of the form's */
  export let compact = false;

  const dispatch = createEventDispatcher<{ done: void }>();
  const tabs = [
    ['signup', 'social.signUp'],
    ['login', 'social.logIn']
  ] as const;

  let username = '';
  let name = '';
  let password = '';
  let recoveryInput = '';
  let error = '';
  let busy = false;
  /** Shown once after signing up or a reset */
  let recovery = '';
  let saved = false;

  $: privacyUrl = (() => {
    try {
      return `${hubOrigin()}/privacy`;
    } catch (_) {
      return '';
    }
  })();

  async function submit() {
    error = '';
    if (password.length < 10) {
      error = $t$('social.passwordShort');
      return;
    }
    busy = true;
    try {
      if (mode === 'signup') recovery = await signUp(username.trim(), name.trim(), password);
      else if (mode === 'forgot') {
        recovery = await recoverAccount(username.trim(), recoveryInput, password);
      } else {
        await logIn(username.trim(), password);
        dispatch('done');
      }
      password = '';
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
    busy = false;
  }
</script>

{#if recovery}
  <div class="social-form">
    <p class="social-step">{$t$('social.step2')}</p>
    <h1 class="social-title">{$t$('social.recoveryTitle')}</h1>
    <p class="social-lead">{$t$('social.recoveryLead')}</p>
    <RecoveryCode code={recovery} {username} />
    <p class="social-note">{$t$('social.recoveryWarning')}</p>
    <label class="social-check">
      <input type="checkbox" bind:checked={saved} />
      {$t$('social.recoverySaved')}
    </label>
    <button
      type="button"
      class="app-button app-button-primary social-wide"
      disabled={!saved}
      on:click={() => dispatch('done')}
    >
      {$t$('social.continue')}
    </button>
  </div>
{:else}
  <form class="social-form" on:submit|preventDefault={submit}>
    {#if mode === 'forgot'}
      <button type="button" class="app-button-quiet social-back" on:click={() => (mode = 'login')}>
        ← {$t$('social.logIn')}
      </button>
      <h1 class="social-title">{$t$('social.resetTitle')}</h1>
      <p class="social-lead">{$t$('social.resetLead')}</p>
    {:else}
      {#if !compact}
        <h1 class="social-title">{$t$('social.friends')}</h1>
        <p class="social-lead">{$t$('social.signUpLead')}</p>
      {/if}
      <div class="app-segmented social-tabs" role="radiogroup" aria-label={$t$('social.account')}>
        {#each tabs as [key, label]}
          <button
            type="button"
            role="radio"
            aria-checked={mode === key}
            class="app-segment"
            class:app-segment-selected={mode === key}
            on:click={() => ((mode = key), (error = ''))}>{$t$(label)}</button
          >
        {/each}
      </div>
    {/if}

    <label class="social-field">
      <span>{$t$('social.username')}</span>
      <input
        class="app-input"
        bind:value={username}
        required
        pattern="[A-Za-z0-9_]{'{'}3,20{'}'}"
        autocomplete="username"
        autocapitalize="off"
        spellcheck="false"
      />
      {#if mode === 'signup'}
        <small>{$t$('social.usernameHint', { username: username || 'name' })}</small>
      {/if}
    </label>
    {#if mode === 'signup'}
      <label class="social-field">
        <span>{$t$('social.displayName')}</span>
        <input
          class="app-input"
          bind:value={name}
          required
          maxlength="40"
          autocomplete="nickname"
        />
      </label>
    {/if}
    {#if mode === 'forgot'}
      <label class="social-field">
        <span>{$t$('social.recoveryCode')}</span>
        <input
          class="app-input"
          bind:value={recoveryInput}
          required
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
        />
        <small>{$t$('social.recoveryHint')}</small>
      </label>
    {/if}
    <label class="social-field">
      <span>{$t$(mode === 'forgot' ? 'social.newPassword' : 'social.password')}</span>
      <input
        class="app-input"
        type="password"
        bind:value={password}
        required
        minlength="10"
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
      />
      {#if mode !== 'login'}<small>{$t$('social.passwordHint')}</small>{/if}
    </label>

    {#if error}<p class="social-error" role="alert">{error}</p>{/if}

    <button type="submit" class="app-button app-button-primary social-wide" disabled={busy}>
      {$t$(
        mode === 'signup'
          ? 'social.signUp'
          : mode === 'login'
            ? 'social.logIn'
            : 'social.setPassword'
      )}
    </button>

    {#if mode === 'forgot'}
      <p class="social-note">{$t$('social.resetNote')}</p>
      <p class="social-small">{$t$('social.resetLost')}</p>
    {:else}
      <p class="social-small">
        {#if mode === 'signup'}
          {$t$('social.haveAccount')}
          <button type="button" class="app-button-quiet" on:click={() => (mode = 'login')}>
            {$t$('social.logIn')}
          </button>
          ·
        {/if}
        <button type="button" class="app-button-quiet" on:click={() => (mode = 'forgot')}>
          {$t$('social.forgot')}
        </button>
      </p>
      <p class="social-note">
        {$t$('social.privacyNote')}
        {#if privacyUrl}
          <a class="app-button-quiet" href={privacyUrl} target="_blank" rel="noreferrer"
            >{$t$('social.whatHubStores')}</a
          >
        {/if}
      </p>
    {/if}
  </form>
{/if}

<style>
  .social-form {
    display: flex;
    max-width: 30rem;
    flex-direction: column;
    gap: 1.25rem;
  }

  .social-step {
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .social-title {
    font-size: var(--type-h1);
    font-weight: 400;
    line-height: 1.2;
  }

  .social-step + .social-title {
    margin-top: -0.75rem;
  }

  .social-lead {
    margin-top: -0.5rem;
    color: var(--app-muted-fg);
  }

  .social-back {
    align-self: flex-start;
  }

  .social-tabs {
    align-self: flex-start;
  }

  .social-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-weight: 700;
  }

  .social-field small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .social-wide {
    width: 100%;
  }

  .social-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .social-small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .social-note {
    padding: 0.75rem 1rem;
    background: var(--surface-color);
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .social-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .social-check input {
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--accent-color);
  }
</style>
