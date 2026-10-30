<script lang="ts">
  import Switch from '$lib/components/switch.svelte';
  import { goto } from '$app/navigation';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import PictureCrop from '$lib/components/social/picture-crop.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import RecoveryCode from '$lib/components/social/recovery-code.svelte';
  import { pagePath, standalone } from '$lib/data/env';
  import {
    avatarKanji,
    changeSocialPassword,
    deleteSocialAccount,
    hubErrorKey,
    hubOrigin,
    logOut,
    logOutEverywhere,
    newRecoveryCode,
    shareDefaults,
    socialHub$,
    socialHubDefault,
    socialSession$,
    queueProfileChange,
    flushProfileChanges,
    removePicture,
    refreshMe,
    type ShareKey,
    type SocialMe
  } from '$lib/data/social-account';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { setPluginEnabled } from '$lib/plugins';
  import { onDestroy, onMount } from 'svelte';

  /** Settings → Social (boards 16-19): the switch, the hub account, profile and what it shows. */

  const shareKeys: ShareKey[] = [
    'current',
    'finished',
    'activity',
    'stats',
    'wordsKnown',
    'hideManga',
    'hideVn'
  ];

  let error = '';
  let name = '';
  /** A picture being cropped */
  let pictureFile: File | undefined;
  let pictureInput: HTMLInputElement;

  $: me = $socialSession$?.me;
  $: if (me && !name) name = me.name;
  $: since = me
    ? new Intl.DateTimeFormat($uiLanguage$, { month: 'long', year: 'numeric' }).format(
        me.created * 1000
      )
    : '';
  $: privacyUrl = (() => {
    try {
      return `${hubOrigin($socialHub$)}/privacy`;
    } catch (_) {
      return '';
    }
  })();

  const showsLabel = (key: ShareKey) => `social.shows.${key}` as MessageKey;
  $: shared = (key: ShareKey) => me?.share[key] ?? shareDefaults[key];

  const showError = (e: unknown) => (error = $t$(hubErrorKey(e)));

  function save(patch: Partial<Pick<SocialMe, 'name' | 'avatar' | 'share'>>) {
    error = '';
    queueProfileChange(patch, showError);
  }

  onDestroy(() => flushProfileChanges().catch(showError));
  // A role granted since signing in (the Moderation row) shows without signing in again.
  onMount(() => {
    if ($socialSession$) refreshMe().catch(() => {});
  });

  function pickPicture() {
    const [file] = pictureInput.files ?? [];

    pictureInput.value = '';
    if (file) pictureFile = file;
  }

  async function dropPicture() {
    error = '';
    await removePicture().catch(showError);
  }

  async function remove() {
    if (!window.confirm($t$('social.deleteConfirm'))) return;
    error = '';
    try {
      await deleteSocialAccount();
      name = '';
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  let open: '' | 'password' | 'recovery' = '';
  let current = '';
  let next = '';
  let busy = false;
  let formError = '';
  let passwordNotice = '';
  /** A new recovery code, shown once */
  let newCode = '';

  function toggle(form: typeof open) {
    open = open === form ? '' : form;
    current = next = newCode = formError = '';
  }

  async function run(task: () => Promise<void>) {
    formError = '';
    busy = true;
    try {
      await task();
    } catch (e) {
      formError = $t$(hubErrorKey(e));
    }
    busy = false;
  }

  function submitPassword() {
    if (next.length < 10) {
      formError = $t$('social.passwordShort');
      return;
    }
    run(async () => {
      await changeSocialPassword(current, next);
      toggle('');
      passwordNotice = $t$('social.passwordChanged');
    });
  }

  function submitRecovery() {
    run(async () => {
      const code = await newRecoveryCode(current);

      current = '';
      newCode = code;
    });
  }

  async function signOutEverywhere() {
    if (!window.confirm($t$('social.signOutEverywhereConfirm'))) return;
    error = '';
    try {
      await logOutEverywhere();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }
</script>

<SettingsSection id="social-features" keywords="friends social hub">
  <SettingsItemGroup title={$t$('social.features')}>
    <Switch
      checked={true}
      aria-label={$t$('social.features')}
      onchange={() => setPluginEnabled('social', false)}
    />
  </SettingsItemGroup>
</SettingsSection>

<SettingsSection id="social-account" keywords="sign in log in sign up username password">
  {#if me}
    <SettingsItemGroup
      title={$t$('social.signedInAs', { username: me.username })}
      tooltip={$t$('social.memberSince', { since })}
    >
      <button type="button" class="app-button" on:click={logOut}>{$t$('social.signOut')}</button>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('social.password')} tooltip={passwordNotice}>
      <button
        type="button"
        class="app-button"
        aria-expanded={open === 'password'}
        on:click={() => toggle('password')}>{$t$('social.changePassword')}</button
      >
      <svelte:fragment slot="after">
        {#if open === 'password'}
          <form class="social-settings-form" on:submit|preventDefault={submitPassword}>
            <label class="social-settings-field">
              <span>{$t$('social.currentPassword')}</span>
              <input
                class="app-input"
                type="password"
                bind:value={current}
                required
                autocomplete="current-password"
              />
            </label>
            <label class="social-settings-field">
              <span>{$t$('social.newPassword')}</span>
              <input
                class="app-input"
                type="password"
                bind:value={next}
                required
                minlength="10"
                autocomplete="new-password"
              />
              <small>{$t$('social.passwordHint')} {$t$('social.passwordOthers')}</small>
            </label>
            {#if formError}<p class="social-settings-error" role="alert">{formError}</p>{/if}
            <span class="social-settings-actions">
              <button type="submit" class="app-button app-button-primary" disabled={busy}>
                {$t$('social.changePassword')}
              </button>
              <button type="button" class="app-button app-button-quiet" on:click={() => toggle('')}>
                {$t$('social.cancel')}
              </button>
            </span>
          </form>
        {/if}
      </svelte:fragment>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('social.recoveryCode')} tooltip={$t$('social.recoveryRowHint')}>
      <button
        type="button"
        class="app-button"
        aria-expanded={open === 'recovery'}
        on:click={() => toggle('recovery')}>{$t$('social.newRecoveryCode')}</button
      >
      <svelte:fragment slot="after">
        {#if open === 'recovery' && newCode}
          <div class="social-settings-form">
            <p>{$t$('social.newRecoveryLead')}</p>
            <RecoveryCode code={newCode} username={me.username} />
            <span class="social-settings-actions">
              <button
                type="button"
                class="app-button app-button-primary"
                on:click={() => toggle('')}
              >
                {$t$('social.recoverySaved')}
              </button>
            </span>
          </div>
        {:else if open === 'recovery'}
          <form class="social-settings-form" on:submit|preventDefault={submitRecovery}>
            <label class="social-settings-field">
              <span>{$t$('social.currentPassword')}</span>
              <input
                class="app-input"
                type="password"
                bind:value={current}
                required
                autocomplete="current-password"
              />
            </label>
            {#if formError}<p class="social-settings-error" role="alert">{formError}</p>{/if}
            <span class="social-settings-actions">
              <button type="submit" class="app-button app-button-primary" disabled={busy}>
                {$t$('social.newRecoveryCode')}
              </button>
              <button type="button" class="app-button app-button-quiet" on:click={() => toggle('')}>
                {$t$('social.cancel')}
              </button>
            </span>
          </form>
        {/if}
      </svelte:fragment>
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('social.otherDevices')}>
      <button type="button" class="app-button" on:click={signOutEverywhere}>
        {$t$('social.signOutEverywhere')}
      </button>
    </SettingsItemGroup>
    {#if me.role === 'dev'}
      <SettingsItemGroup title={$t$('social.moderation')}>
        <a class="app-button app-button-quiet" href="{pagePath}/moderation"
          >{$t$('social.moderationOpen')} →</a
        >
      </SettingsItemGroup>
    {/if}
  {:else}
    <SettingsItemGroup title={$t$('social.notSignedIn')} tooltip={$t$('social.notSignedInHint')}>
      <button
        type="button"
        class="app-button app-button-primary"
        on:click={() => goto(`${pagePath}/friends`)}
      >
        {$t$('social.signUpOrLogIn')}
      </button>
    </SettingsItemGroup>
  {/if}
</SettingsSection>

{#if me}
  <SettingsSection id="social-profile" keywords="display name avatar public">
    <SettingsItemGroup title={$t$('social.viewProfile')}>
      <a
        class="app-button app-button-quiet"
        href="{pagePath}/u?name={encodeURIComponent(me.username)}">{$t$('social.yourProfile')} →</a
      >
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('social.displayName')}>
      <input
        class="app-input"
        aria-label={$t$('social.displayName')}
        bind:value={name}
        maxlength="40"
        on:change={() => name.trim() && save({ name: name.trim() })}
      />
    </SettingsItemGroup>
    <SettingsItemGroup title={$t$('social.avatar')} wide>
      <div class="social-avatars" role="radiogroup" aria-label={$t$('social.avatar')}>
        {#each avatarKanji as _, index}
          <button
            type="button"
            role="radio"
            aria-checked={me.avatar === index}
            class="social-avatar-choice"
            class:social-avatar-choice-on={me.avatar === index}
            on:click={() => save({ avatar: index })}
          >
            <SocialAvatar avatar={index} size={2.25} label={avatarKanji[index]} />
          </button>
        {/each}
      </div>
      <div class="social-picture">
        {#if me.picture}
          <SocialAvatar avatar={me.avatar} person={me} size={2.75} />
        {/if}
        <button type="button" class="app-button" on:click={() => pictureInput.click()}>
          {$t$('social.uploadPicture')}
        </button>
        {#if me.picture}
          <button type="button" class="app-button app-button-quiet" on:click={dropPicture}>
            {$t$('social.removePicture')}
          </button>
        {/if}
        <input
          bind:this={pictureInput}
          class="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          tabindex="-1"
          aria-hidden="true"
          on:change={pickPicture}
        />
      </div>
      {#if pictureFile}
        {#key pictureFile}
          <PictureCrop
            file={pictureFile}
            avatar={me.avatar}
            on:done={() => (pictureFile = undefined)}
          />
        {/key}
      {/if}
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t$('social.publicProfile')}
      tooltip={$t$('social.publicProfileHint', { username: me.username })}
    >
      <Switch
        checked={shared('public')}
        aria-label={$t$('social.publicProfile')}
        onchange={() => save({ share: { public: !shared('public') } })}
      />
    </SettingsItemGroup>
  </SettingsSection>

  <SettingsSection id="social-shows" keywords="share current finished activity stats words manga">
    {#each shareKeys as key (key)}
      <SettingsItemGroup title={$t$(showsLabel(key))}>
        <Switch
          checked={shared(key)}
          aria-label={$t$(showsLabel(key))}
          onchange={() => save({ share: { [key]: !shared(key) } })}
        />
      </SettingsItemGroup>
    {/each}
  </SettingsSection>
{/if}

<SettingsSection id="social-hub" keywords="hub address privacy delete account">
  <SettingsItemGroup
    title={$t$('social.hubAddress')}
    tooltip={$t$(standalone ? 'social.hubAddressHint' : 'social.hubAddressServer')}
    wide
  >
    <input
      class="app-input"
      type="url"
      aria-label={$t$('social.hubAddress')}
      placeholder={socialHubDefault}
      disabled={!standalone || !!me}
      bind:value={$socialHub$}
    />
  </SettingsItemGroup>
  {#if privacyUrl}
    <SettingsItemGroup title={$t$('social.privacy')}>
      <a class="app-button app-button-quiet" href={privacyUrl} target="_blank" rel="noreferrer"
        >{$t$('social.read')} →</a
      >
    </SettingsItemGroup>
  {/if}
  {#if me}
    <SettingsItemGroup title={$t$('social.deleteAccount')} tooltip={$t$('social.deleteHint')}>
      <button type="button" class="app-button app-button-danger" on:click={remove}>
        {$t$('social.deleteButton')}
      </button>
    </SettingsItemGroup>
  {/if}
  {#if error}<p class="social-settings-error" role="alert">{error}</p>{/if}
</SettingsSection>

<style>
  .social-avatars {
    display: grid;
    grid-template-columns: repeat(8, max-content);
    gap: 0.4rem;
  }

  .social-picture {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-top: 0.75rem;
  }

  .social-avatar-choice {
    display: flex;
    padding: 2px;
    border: 2px solid transparent;
    border-radius: 50%;
  }

  .social-avatar-choice-on {
    border-color: var(--font-color);
  }

  .social-avatar-choice:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .social-settings-form {
    display: flex;
    max-width: 28rem;
    flex-direction: column;
    gap: 1rem;
    padding-top: 0.75rem;
  }

  .social-settings-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-weight: 700;
  }

  .social-settings-field small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .social-settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .social-settings-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  @media (max-width: 400px) {
    .social-avatars {
      grid-template-columns: repeat(6, max-content);
    }
  }
</style>
