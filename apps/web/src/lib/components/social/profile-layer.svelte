<script lang="ts">
  import ProfileView from '$lib/components/social/profile-view.svelte';
  import { loadProfile, type Profile } from '$lib/data/social';
  import { hubErrorKey } from '$lib/data/social-account';
  import { pagePath, standalone } from '$lib/data/env';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * A profile as a full-screen layer over Home or /friends, opened with shallow routing
   * (`PageState.profile`), so Back closes it, like the book page.
   */
  export let username: string;
  export let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined;
  export let back: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  let layer: HTMLElement;
  let profile: Profile | null | undefined;
  let error = '';

  $: load(username);

  async function load(name: string) {
    profile = undefined;
    error = '';
    try {
      profile = await loadProfile(name);
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  onMount(() => layer.focus());
</script>

<svelte:window on:keydown={(ev) => ev.key === 'Escape' && dispatch('close')} />

<div
  class="profile-layer"
  role="dialog"
  aria-modal="true"
  aria-labelledby="profile-name"
  tabindex="-1"
  bind:this={layer}
>
  <nav class="profile-layer-bar" aria-label={$t$('nav.back')}>
    <button type="button" class="app-button app-button-quiet" on:click={() => dispatch('close')}>
      ← {back}
    </button>
    <span class="profile-layer-crumb">
      / {profile?.relation === 'self' ? $t$('social.yourProfile') : (profile?.profile.name ?? '')}
    </span>
    {#if !standalone && profile?.relation === 'self'}
      <!-- The header's account control opens this with social on: the server account stays a click away. -->
      <a
        class="app-button app-button-quiet profile-layer-account"
        href="{pagePath}/settings?section=general#general-account">{$t$('social.serverAccount')}</a
      >
    {/if}
  </nav>
  <div class="profile-layer-body">
    {#if profile}
      <ProfileView {profile} {covers} on:removed={() => dispatch('close')} />
    {:else if profile === null}
      <p class="profile-layer-note">{$t$('social.profileGone')}</p>
    {:else if error}
      <p class="profile-layer-note" role="alert">{error}</p>
    {/if}
  </div>
</div>

<style>
  .profile-layer {
    position: fixed;
    /* Under the app header (4rem, 3.25rem from xl) and the phones' bottom tab bar */
    inset: 4rem 0 0;
    z-index: 39;
    outline: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--background-color);
    color: var(--font-color);
  }

  @media (min-width: 1280px) {
    .profile-layer {
      top: 3.25rem;
    }
  }

  @media (max-width: 639px) {
    .profile-layer {
      bottom: calc(3.5rem + env(safe-area-inset-bottom));
    }
  }

  .profile-layer-bar {
    display: flex;
    min-width: 0;
    max-width: 75rem;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 auto;
    padding: 1.25rem 1rem 0;
  }

  .profile-layer-account {
    margin-left: auto;
    flex: none;
  }

  .profile-layer-crumb,
  .profile-layer-note {
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-layer-body {
    max-width: 75rem;
    margin: 0 auto;
    padding: 2rem 1rem calc(3rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .profile-layer-bar {
      padding: 1.5rem 2.5rem 0;
    }

    .profile-layer-body {
      padding: 2.5rem 2.5rem 4rem;
    }
  }
</style>
