<script lang="ts">
  import { goto } from '$app/navigation';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { onMount, type ComponentType } from 'svelte';
  import { map, share } from 'rxjs';
  import Fa from 'svelte-fa';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/book-card/import-menu.svelte';
  import { setPendingImport, type PendingImport } from '$lib/data/library-home';
  import AdminSection from '$lib/components/admin/admin-section.svelte';
  import EngineTool from '$lib/components/admin/engine-tool.svelte';
  import CatalogTool from '$lib/components/admin/catalog-tool.svelte';
  import SeriesTool from '$lib/components/admin/series-tool.svelte';
  import UpdateTool from '$lib/components/admin/update-tool.svelte';
  import DifficultyPanel from '$lib/components/book-card/difficulty-panel.svelte';
  import SettingsAdmin from '$lib/components/settings/settings-admin.svelte';
  import {
    account$,
    accountUnreachable$,
    canOpenAdminPanel,
    hasPermission
  } from '$lib/data/account';
  import { pagePath } from '$lib/data/env';
  import { database } from '$lib/data/store';
  import { formatPageTitle } from '$lib/functions/format-page-title';

  type Tab = 'accounts' | 'tools';

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let tab: Tab = 'accounts';

  // The server refuses admin and tool requests without the right account;
  // this only keeps the controls away from people who can't use them.
  $: user = $account$;
  $: tabs = [
    { id: 'accounts' as Tab, label: 'Accounts', show: !!user?.admin },
    { id: 'tools' as Tab, label: 'Tools', show: hasPermission(user, 'difficulty') }
  ].filter((candidate) => candidate.show);
  // Section numbers follow the tools this account sees.
  let tools: { title: string; component: ComponentType; props?: Record<string, unknown> }[] = [];
  $: tools = [
    ...(user?.admin
      ? [
          { title: 'Updates', component: UpdateTool },
          { title: 'Visual novel engine', component: EngineTool },
          { title: 'Catalog', component: CatalogTool },
          { title: 'Series', component: SeriesTool }
        ]
      : []),
    ...(hasPermission(user, 'difficulty')
      ? [{ title: 'Estimate difficulty', component: DifficultyPanel, props: { admin: true } }]
      : [])
  ];
  $: if (tabs.length && !tabs.some((candidate) => candidate.id === tab)) {
    tab = tabs[0].id;
  }

  onMount(() => {
    const requested = new URL(window.location.href).searchParams.get('tab');

    if (requested === 'accounts' || requested === 'tools') {
      tab = requested;
    }
  });

  function importOnManage(value: PendingImport) {
    setPendingImport(value);
    goto(`${pagePath}/manage`);
  }
</script>

<svelte:head>
  <title>{formatPageTitle('Admin')}</title>
</svelte:head>

<div class="app-page-shell">
  <AppHeader active={undefined} currentBookId={$currentBookId$}>
    <!-- The import runs (with its progress and errors) in the library. -->
    <ImportMenu
      on:filesChange={(ev) => importOnManage({ files: Array.from(ev.detail) })}
      on:importBackup={(ev) => importOnManage({ backup: ev.detail })}
    />
  </AppHeader>

  <main class="admin">
    <h1 class="admin-title">Admin panel</h1>

    {#if user === undefined}
      <p class="flex items-center gap-2"><Fa icon={faSpinner} spin /> Checking sign-in...</p>
    {:else if !canOpenAdminPanel(user)}
      <p class="admin-no-access">
        {#if user}
          This account can't use the admin panel.
        {:else if $accountUnreachable$}
          The server can't be reached, so the admin panel can't open right now.
        {:else}
          You need to sign in with an account that can use the admin panel.
        {/if}
        <a
          class="app-button app-button-quiet"
          href="{pagePath}/settings?section=general#general-account">Account settings</a
        >
      </p>
    {:else}
      <div class="admin-tabs" role="tablist">
        {#each tabs as candidate (candidate.id)}
          <button
            role="tab"
            class="admin-tab"
            aria-selected={tab === candidate.id}
            on:click={() => (tab = candidate.id)}
          >
            {candidate.label}
          </button>
        {/each}
      </div>

      <div class="admin-sections" role="tabpanel">
        {#if tab === 'accounts' && user?.admin}
          <SettingsAdmin self={user} />
        {:else if tab === 'tools'}
          {#each tools as tool, index (tool.title)}
            <AdminSection number={index + 1} title={tool.title}>
              <svelte:component this={tool.component} {...tool.props} />
            </AdminSection>
          {/each}
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .admin {
    display: flex;
    max-width: 60rem;
    flex-direction: column;
    gap: 2rem;
    margin: 0 auto;
    padding: 6.25rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .admin {
      padding: 6.25rem 2.5rem 4rem;
    }
  }

  .admin-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .admin-no-access {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .admin-tabs {
    display: flex;
    gap: 1.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .admin-tab {
    min-height: 2.75rem;
    margin-bottom: -1px;
    padding: 0;
    border-bottom: 3px solid transparent;
    color: var(--app-muted-fg);
    font-size: var(--type-body);
  }

  .admin-tab:hover {
    color: var(--font-color);
  }

  .admin-tab[aria-selected='true'] {
    border-bottom-color: var(--accent-color);
    color: var(--font-color);
  }

  .admin-sections {
    display: grid;
    gap: 3.5rem;
  }
</style>
