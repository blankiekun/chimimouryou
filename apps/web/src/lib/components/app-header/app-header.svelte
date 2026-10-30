<script lang="ts" context="module">
  export type AppSection = 'library' | 'words' | 'community' | 'settings' | 'profile';
</script>

<script lang="ts">
  import {
    faArrowLeft,
    faBook,
    faBookOpenReader,
    faComments,
    faGear,
    faHouse,
    faLanguage,
    faStore
  } from '@fortawesome/free-solid-svg-icons';
  import AppHeaderLogo from '$lib/components/app-header/app-header-logo.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import SyncIndicator from '$lib/components/standalone/sync-indicator.svelte';
  import { account$ } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$, type LibraryTab } from '$lib/data/library/library-home';
  import { readerPath } from '$lib/data/reader/reader-route';
  import { database } from '$lib/data/store';
  import { socialSession$ } from '$lib/data/social/social-account';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import Fa from 'svelte-fa';

  export let active: AppSection | undefined;
  export let currentBookId: number | undefined = undefined;

  // The last item's page (VN, manga or reader), so Continue skips the reader's redirect.
  const lastItem$ = database.lastItem$;
  /** Intercepts section links, e.g. so the reader can save progress before leaving. */
  export let onNavigate: ((section: AppSection, href: string) => void) | undefined = undefined;
  /** When set, small screens show a back button instead of the section navigation. */
  export let onBack: (() => void) | undefined = undefined;
  /** Only the logo, for the standalone's first run */
  export let bare = false;

  function navigate(event: MouseEvent, section: AppSection, href: string, tab?: LibraryTab) {
    if (tab) $libraryTab$ = tab;
    if (onNavigate) {
      event.preventDefault();
      onNavigate(section, href);
    }
  }

  let sections: {
    key: AppSection;
    /** The library's Home or Store tab */
    tab?: LibraryTab;
    label: string;
    icon: typeof faBook;
    href: string;
  }[];
  $: sections = [
    {
      key: 'library',
      tab: 'home',
      label: $t$('nav.home'),
      icon: faHouse,
      href: `${pagePath}/manage`
    },
    {
      key: 'library',
      tab: 'store',
      // The standalone has no store to browse: it lists the books imported here.
      label: $t$(standalone ? 'nav.library' : 'nav.store'),
      icon: faStore,
      href: `${pagePath}/manage`
    },
    {
      key: 'words',
      label: $t$('nav.words'),
      icon: faLanguage,
      href: `${pagePath}/words`
    },
    ...(socialOn
      ? [
          {
            key: 'community' as const,
            label: $t$('nav.community'),
            icon: faComments,
            href: `${pagePath}/community`
          }
        ]
      : []),
    { key: 'settings', label: $t$('nav.settings'), icon: faGear, href: `${pagePath}/settings` }
  ];

  // The avatar at the end opens Profile (statistics; the hub profile when signed in to it): the
  // hub picture with social on, else the server account's initial, else an empty circle.
  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  $: hubMe = socialOn ? $socialSession$?.me : undefined;

  $: isActive = (section: (typeof sections)[number]) =>
    section.key === active && (!section.tab || section.tab === $libraryTab$);
</script>

<header class="fixed inset-x-0 top-0 z-40">
  <div
    class="app-header-surface relative h-16 border-b border-[color:var(--app-header-border)] text-[color:var(--app-header-fg)] xl:h-[3.25rem]"
  >
    <div class="flex h-full items-center gap-2 px-3 sm:gap-6 sm:px-5 xl:px-8">
      {#if onBack}
        <button
          type="button"
          class="app-header-icon sm:hidden"
          title={$t$('nav.back')}
          aria-label={$t$('nav.back')}
          on:click={onBack}
        >
          <Fa icon={faArrowLeft} />
        </button>
      {/if}

      <a
        href="{pagePath}/manage"
        class="app-brand {onBack ? 'hidden sm:flex' : 'flex'}"
        title="Chimimouryou"
        on:click={(event) => navigate(event, 'library', `${pagePath}/manage`, 'home')}
      >
        <AppHeaderLogo label="Chimimouryou" />
      </a>

      <nav class="section-nav hidden {bare ? '' : 'sm:flex'}" aria-label={$t$('nav.sections')}>
        {#each sections as section (section.label)}
          <a
            href={section.href}
            class="section-nav-item"
            class:section-nav-item-active={isActive(section)}
            aria-current={isActive(section) ? 'page' : undefined}
            title={section.label}
            on:click={(event) => navigate(event, section.key, section.href, section.tab)}
          >
            <Fa icon={section.icon} class="md:hidden" />
            <span class="hidden md:inline">{section.label}</span>
          </a>
        {/each}
      </nav>

      <div class="ml-auto flex min-w-0 items-center gap-1" class:hidden={bare}>
        {#if currentBookId}
          <a
            href={readerPath(
              currentBookId,
              $lastItem$?.dataId === currentBookId ? $lastItem$.route : undefined
            )}
            class="app-header-icon app-header-continue"
            title={$t$('nav.continueReading')}
          >
            <Fa icon={faBookOpenReader} />
            <span class="hidden lg:inline">{$t$('nav.continue')}</span>
          </a>
        {/if}
        {#if $$slots.default}
          <div class="app-header-pill">
            <slot />
          </div>
        {/if}
        {#if standalone}
          <SyncIndicator />
        {/if}
        <a
          href="{pagePath}/profile"
          class="app-profile"
          class:app-profile-active={active === 'profile'}
          aria-current={active === 'profile' ? 'page' : undefined}
          title={$t$('nav.profile')}
          aria-label={$t$('nav.profile')}
          on:click={(event) => navigate(event, 'profile', `${pagePath}/profile`)}
        >
          {#if hubMe}
            <SocialAvatar avatar={hubMe.avatar} person={hubMe} size={1.75} />
          {:else if $account$}
            <span class="account-initial">{$account$.username.charAt(0)}</span>
          {:else}
            <span class="account-empty" />
          {/if}
        </a>
      </div>
    </div>
  </div>
</header>

{#if !onBack && !bare}
  <nav class="app-bottom-nav" aria-label={$t$('nav.sections')}>
    {#each sections as section (section.label)}
      <a
        href={section.href}
        class="bottom-nav-item"
        class:bottom-nav-item-active={isActive(section)}
        aria-current={isActive(section) ? 'page' : undefined}
        on:click={(event) => navigate(event, section.key, section.href, section.tab)}
      >
        <Fa icon={section.icon} />
        <span>{section.label}</span>
      </a>
    {/each}
  </nav>
{/if}

<style>
  /* Study Book top bar: the ち mark in the spot colour, text tabs with a 3px spot underline. */
  .app-brand {
    flex-shrink: 0;
    align-items: center;
    color: var(--accent-color);
  }

  /* The avatar opens Profile; a 2px spot ring while there */
  .app-profile {
    display: inline-flex;
    flex-shrink: 0;
    width: 2.75rem;
    height: 2.75rem;
    align-items: center;
    justify-content: center;
  }

  .app-profile > :global(*) {
    outline-offset: 2px;
  }

  .app-profile-active > :global(*) {
    outline: 2px solid var(--accent-color);
  }

  .account-empty {
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid var(--app-header-icon-fg);
    border-radius: 9999px;
  }

  .account-initial {
    display: inline-flex;
    width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: var(--app-header-fg);
    color: var(--app-header-bg);
    font-size: var(--type-small);
    font-weight: 700;
    text-transform: uppercase;
  }

  .section-nav {
    height: 100%;
    min-width: 0;
    align-items: stretch;
    gap: 0.25rem;
  }

  .section-nav-item {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.75rem;
    color: var(--app-header-icon-fg);
    font-size: var(--type-body);
    white-space: nowrap;
    transition: color 0.15s var(--app-ease);
  }

  .section-nav-item::after {
    content: '';
    position: absolute;
    inset: auto 0.75rem -1px;
    height: 3px;
    background: transparent;
  }

  .section-nav-item:hover,
  .section-nav-item-active {
    color: var(--app-header-fg);
  }

  .section-nav-item-active {
    font-weight: 700;
  }

  .section-nav-item-active::after {
    background: var(--accent-color);
  }

  .app-bottom-nav {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    display: none;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid var(--app-header-border);
    background: var(--app-header-bg);
  }

  @media (max-width: 639px) {
    .app-bottom-nav {
      display: grid;
    }
  }

  .bottom-nav-item {
    position: relative;
    display: flex;
    min-height: 3.5rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    color: var(--app-header-icon-fg);
    font-size: var(--type-small);
    white-space: nowrap;
  }

  .bottom-nav-item-active {
    color: var(--app-header-fg);
    font-weight: 700;
  }

  .bottom-nav-item-active :global(svg) {
    color: var(--accent-color);
  }

  .bottom-nav-item-active::before {
    content: '';
    position: absolute;
    top: -1px;
    inset-inline: 25%;
    height: 3px;
    background: var(--accent-color);
  }
</style>
