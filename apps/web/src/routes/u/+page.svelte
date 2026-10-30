<script lang="ts">
  import { browser } from '$app/env';
  import { page } from '$lib/data/page-store';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ProfileView from '$lib/components/social/profile-view.svelte';
  import { pagePath } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import { localCovers, loadProfile, type Profile } from '$lib/data/social/social';
  import { hubErrorKey, socialSession$ } from '$lib/data/social/social-account';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import { onMount } from 'svelte';

  /**
   * A reader's profile at /u?name=USERNAME: public ones for anyone, without an account (Add
   * friend starts signing up), private ones for friends. A query rather than /u/NAME so the
   * static build serves it as a real page (200) on nginx and GitHub Pages alike.
   */

  let profile: Profile | null | undefined;
  let error = '';
  let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined;

  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  $: username = browser ? ($page.url.searchParams.get('name') ?? '') : '';
  $: if (browser && socialOn) load(username, $socialSession$?.me.id);

  async function load(name: string, _viewer?: string) {
    profile = undefined;
    error = '';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) {
      profile = null;
      return;
    }
    try {
      profile = await loadProfile(name);
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  onMount(() => {
    $libraryTab$ = 'home';
    localCovers().then(
      (found) => (covers = found),
      () => {}
    );
  });
</script>

<svelte:head>
  <title
    >{formatPageTitle(
      profile ? `${profile.profile.name} (@${profile.profile.username})` : ''
    )}</title
  >
  {#if profile}
    <meta
      name="description"
      content={$t$('social.profileDescription', { name: profile.profile.name })}
    />
  {/if}
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="u-page">
    {#if !socialOn}
      <p class="u-note">{$t$('social.offText')}</p>
    {:else if profile}
      <ProfileView {profile} {covers} on:removed={() => load(username)} />
    {:else if profile === null}
      <h1 class="u-title">{$t$('social.profileGoneTitle')}</h1>
      <p class="u-note">{$t$('social.profileGone')}</p>
      <a class="app-button-quiet" href="{pagePath}/manage">← {$t$('nav.home')}</a>
    {:else if error}
      <p class="u-note" role="alert">{error}</p>
    {/if}
  </main>
</div>

<style>
  .u-page {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .u-page {
      padding: 6rem 2.5rem 4rem;
    }
  }

  .u-title {
    font-size: var(--type-h1);
    font-weight: 400;
  }

  .u-note {
    color: var(--app-muted-fg);
  }

  .u-page > a {
    align-self: flex-start;
  }
</style>
