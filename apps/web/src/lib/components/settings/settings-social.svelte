<script lang="ts">
  import { goto } from '$app/navigation';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { pagePath, standalone } from '$lib/data/env';
  import {
    avatarKanji,
    deleteSocialAccount,
    hubErrorKey,
    hubOrigin,
    logOut,
    shareDefaults,
    socialHub$,
    socialHubDefault,
    socialSession$,
    queueProfileChange,
    flushProfileChanges,
    type ShareKey,
    type SocialMe
  } from '$lib/data/social-account';
  import { t$, uiLanguage$, type MessageKey } from '$lib/i18n';
  import { setPluginEnabled } from '$lib/plugins';
  import { onDestroy } from 'svelte';

  /** Settings → Social (boards 16-19): the switch, the hub account, profile and what it shows. */

  const shareRows: { key: ShareKey; hint?: MessageKey }[] = [
    { key: 'current', hint: 'social.shows.currentHint' },
    { key: 'finished' },
    { key: 'activity', hint: 'social.shows.activityHint' },
    { key: 'stats', hint: 'social.shows.statsHint' },
    { key: 'wordsKnown', hint: 'social.shows.wordsKnownHint' },
    { key: 'hideManga' },
    { key: 'hideVn' }
  ];

  let error = '';
  let name = '';

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

  const switchLabel = (on: boolean) => $t$(on ? 'settings.on' : 'settings.off');
</script>

<SettingsSection id="social-features" keywords="friends social hub">
  <SettingsItemGroup title={$t$('social.features')} tooltip={$t$('social.featuresHint')}>
    <button
      type="button"
      role="switch"
      class="app-switch"
      aria-checked="true"
      aria-label={$t$('social.features')}
      on:click={() => setPluginEnabled('social', false)}
    >
      <span class="app-switch-thumb" />
      <span class="app-switch-text">{switchLabel(true)}</span>
    </button>
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
    <SettingsItemGroup title={$t$('social.viewProfile')} tooltip={$t$('social.viewProfileHint')}>
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
    <SettingsItemGroup title={$t$('social.avatar')} tooltip={$t$('social.avatarHint')} wide>
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
    </SettingsItemGroup>
    <SettingsItemGroup
      title={$t$('social.publicProfile')}
      tooltip={$t$('social.publicProfileHint', { username: me.username })}
    >
      <button
        type="button"
        role="switch"
        class="app-switch"
        aria-checked={shared('public')}
        aria-label={$t$('social.publicProfile')}
        on:click={() => save({ share: { public: !shared('public') } })}
      >
        <span class="app-switch-thumb" />
        <span class="app-switch-text">{switchLabel(shared('public'))}</span>
      </button>
    </SettingsItemGroup>
  </SettingsSection>

  <SettingsSection id="social-shows" keywords="share current finished activity stats words manga">
    {#each shareRows as row (row.key)}
      <SettingsItemGroup title={$t$(showsLabel(row.key))} tooltip={row.hint ? $t$(row.hint) : ''}>
        <button
          type="button"
          role="switch"
          class="app-switch"
          aria-checked={shared(row.key)}
          aria-label={$t$(showsLabel(row.key))}
          on:click={() => save({ share: { [row.key]: !shared(row.key) } })}
        >
          <span class="app-switch-thumb" />
          <span class="app-switch-text">{switchLabel(shared(row.key))}</span>
        </button>
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
    <SettingsItemGroup title={$t$('social.privacy')} tooltip={$t$('social.privacyHint')}>
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
