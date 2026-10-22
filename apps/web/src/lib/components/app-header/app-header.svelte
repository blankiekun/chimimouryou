<script lang="ts" context="module">
  export type AppSection = 'library' | 'statistics' | 'settings';
</script>

<script lang="ts">
  import {
    faArrowLeft,
    faBook,
    faBookOpenReader,
    faChartLine,
    faGear,
    faHouse,
    faStore,
    faUser
  } from '@fortawesome/free-solid-svg-icons';
  import AppHeaderLogo from '$lib/components/app-header/app-header-logo.svelte';
  import { account$ } from '$lib/data/account';
  import { pagePath } from '$lib/data/env';
  import { libraryTab$, type LibraryTab } from '$lib/data/library-home';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let active: AppSection | undefined;
  export let currentBookId: number | undefined = undefined;
  /** Intercepts section links, e.g. so the reader can save progress before leaving. */
  export let onNavigate: ((section: AppSection, href: string) => void) | undefined = undefined;
  /** When set, small screens show a back button instead of the section navigation. */
  export let onBack: (() => void) | undefined = undefined;

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
      label: $t$('nav.store'),
      icon: faStore,
      href: `${pagePath}/manage`
    },
    {
      key: 'statistics',
      label: $t$('nav.statistics'),
      icon: faChartLine,
      href: `${pagePath}/statistics`
    },
    { key: 'settings', label: $t$('nav.settings'), icon: faGear, href: `${pagePath}/settings` }
  ];

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

      <nav class="section-nav hidden sm:flex" aria-label={$t$('nav.sections')}>
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

      <div class="ml-auto flex min-w-0 items-center gap-1">
        {#if currentBookId}
          <a
            href="{pagePath}/b?id={currentBookId}"
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
        <a
          href="{pagePath}/settings?section=general#general-account"
          class="app-header-icon"
          title={$account$
            ? $t$('nav.signedInAs', { name: $account$.username })
            : $t$('nav.signIn')}
          aria-label={$account$
            ? $t$('nav.account', { name: $account$.username })
            : $t$('nav.signIn')}
        >
          {#if $account$}
            <span class="account-initial">{$account$.username.charAt(0)}</span>
          {:else}
            <Fa icon={faUser} />
          {/if}
        </a>
      </div>
    </div>
  </div>
</header>

{#if !onBack}
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
    font-size: var(--type-label);
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
