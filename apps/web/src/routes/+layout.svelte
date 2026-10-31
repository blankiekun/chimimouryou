<script lang="ts">
  import { browser } from '$app/env';
  import { beforeNavigate } from '$app/navigation';
  import { page } from '$lib/data/page-store';
  import ThemeStyle from '$lib/components/theme/theme-style.svelte';
  import { accountReady } from '$lib/data/account/account';
  import { startSettingsSync } from '$lib/data/account/account-settings-sync';
  import { releaseReaderData } from '$lib/data/account/reader-data-owner';
  import { basePath, clearConsoleOnReload, pagePath, standalone } from '$lib/data/env';
  import { watchInstall } from '$lib/data/standalone/install-app';
  import { catchDownloads } from '$lib/data/standalone/native-save';
  import { watchYomitan } from '$lib/data/dictionary/yomitan';
  import { hasDeviceFollows } from '$lib/data/sources/sources-settings';
  import { dialogManager, type Dialog } from '$lib/data/dialog-manager';
  import { userFontsCacheName, type UserFont } from '$lib/data/fonts';
  import { fontFamilyGroupOne$, isOnline$, userFonts$ } from '$lib/data/store';
  import { reloadOnStaleBuild } from '$lib/functions/reload-on-stale-build';
  import { needsFullLoad } from '$lib/data/reader/reader-route';
  import { dummyFn, isMobile, isMobile$ } from '$lib/functions/utils';
  import { MetaTags } from 'svelte-meta-tags';
  import '$lib/assets/fonts/biz-udpgothic/biz-udpgothic.css';
  import '../app.scss';

  let path = '';
  // The public word tests talk to no server and bring their own tags.
  const wordTest = $page.route.id === '/word-test' || $page.route.id === '/hard-word-test';
  // Prerendered pages don't know their origin: without VITE_BASE_PATH or VITE_HTTPS_URL
  // the tags are set in the browser.
  const siteOrigin = basePath || (browser ? window.location.origin : '');
  let dialogs: Dialog[] = [];
  let clickOnCloseDisabled = false;
  let zIndex = '';

  if (browser) {
    reloadOnStaleBuild(window);
    catchDownloads(window);
    if (standalone) {
      watchInstall(window);
      watchYomitan(window);
      // Sources: followed works update and fetches run while the app is open (local-sources.ts).
      import('$lib/data/sources/local-sources').then((sources) => sources.startLocalSources());
    } else if (hasDeviceFollows()) {
      // Server edition: this device follows extension works, checked here while the app is open.
      import('$lib/data/sources/local-sources').then((sources) => sources.startLocalSources());
    }
    if (!wordTest) {
      accountReady().then(async (user) => {
        await releaseReaderData(user).catch(() => {});
        startSettingsSync(user);
      });
    }
  }

  // The VN player's isolation headers only come with a full page load (needsFullLoad).
  beforeNavigate(({ from, to, type, cancel }) => {
    if (!from || !to || type === 'leave') return;
    if (!needsFullLoad(from.url, to.url, window.crossOriginIsolated)) return;
    // Back/forward has already moved the address: load it.
    if (type === 'popstate') {
      window.location.reload();
      return;
    }
    cancel();
    window.location.assign(to.url.href);
  });

  $: if (browser) {
    isMobile$.next(isMobile(window));
    addUserFonts($userFonts$);
  }

  if (clearConsoleOnReload && import.meta.hot) {
    // eslint-disable-next-line no-console
    import.meta.hot.on('vite:beforeUpdate', () => console.clear());
  }

  function addUserFonts(userFonts: UserFont[]) {
    let styleContent = '';

    for (let index = 0, { length } = userFonts; index < length; index += 1) {
      const userFont = userFonts[index];
      const ext = userFont.fileName.split('.').pop() || '';

      let format = '';

      switch (ext) {
        case 'otf':
          format = 'opentype';
          break;
        case 'ttf':
          format = 'truetype';
          break;
        default:
          format = ext;
          break;
      }

      styleContent += `@font-face{font-family: '${userFont.name}';font-style: normal;font-weight: 400;font-display: swap;src: local(''), url('${userFont.path}') format('${format}')}\n`;
    }

    let styleElement = document.getElementById(userFontsCacheName);

    if (!styleContent) {
      styleElement?.remove();
      return;
    }

    const textNode = document.createTextNode(styleContent);

    if (styleElement) {
      styleElement.replaceChild(textNode, styleElement.childNodes[0]);
    } else {
      styleElement = document.createElement('style');
      styleElement.id = userFontsCacheName;

      styleElement.appendChild(textNode);
      document.head.append(styleElement);
    }
  }

  function closeAllDialogs() {
    dialogManager.dialogs$.next([]);
    clickOnCloseDisabled = false;
    zIndex = '';
  }

  dialogManager.dialogs$.subscribe((d) => {
    clickOnCloseDisabled = d[0]?.disableCloseOnClick ?? false;
    zIndex = d[0]?.zIndex ?? '';
    dialogs = d;
  });

  page.subscribe((p) => (path = p.url.pathname));
</script>

<svelte:window bind:online={$isOnline$} />

{#if !wordTest}
  <MetaTags
    title="Chimimouryou"
    description="Online e-book reader that supports dictionary extensions like Yomitan"
    canonical={siteOrigin ? `${siteOrigin}${path !== '/' ? path : ''}` : undefined}
    openGraph={{
      type: 'website',
      images: siteOrigin
        ? [
            {
              url: `${siteOrigin}${pagePath}/icons/regular-icon@512x512.png`,
              width: 512,
              height: 512
            }
          ]
        : []
    }}
  />
{/if}

<ThemeStyle />

<slot />

{#if dialogs.length > 0}
  <div class="writing-horizontal-tb fixed inset-0 z-50 h-full w-full" style:z-index={zIndex}>
    <div
      tabindex="0"
      role="button"
      class="tap-highlight-transparent absolute inset-0 bg-[color:var(--app-overlay-color)]"
      on:click={() => {
        if (!clickOnCloseDisabled) {
          closeAllDialogs();
        }
      }}
      on:keyup={dummyFn}
    />

    <div
      class="relative top-1/2 left-1/2 inline-block max-w-[80vw] -translate-x-1/2 -translate-y-1/2"
    >
      {#each dialogs as dialog}
        {#if typeof dialog.component === 'string'}
          {@html dialog.component}
        {:else}
          <svelte:component this={dialog.component} {...dialog.props} on:close={closeAllDialogs} />
        {/if}
      {/each}
    </div>
  </div>
{/if}

<span style={`font-family: ${$fontFamilyGroupOne$ || 'Noto Serif JP'}`} />
