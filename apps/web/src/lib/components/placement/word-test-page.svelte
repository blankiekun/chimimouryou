<script lang="ts">
  import { browser } from '$app/env';
  import AppHeaderLogo from '$lib/components/app-header/app-header-logo.svelte';
  import PlacementTest from '$lib/components/placement/placement-test.svelte';
  import { basePath, pagePath } from '$lib/data/env';
  import { tr } from '$lib/i18n';

  /**
   * The public word test (/word-test, /hard-word-test), to share on social media: the
   * placement check for someone who has never opened the app (no header tabs, no first run,
   * no sign-in), with prerendered Open Graph tags. The result is saved like the in-app
   * check's, so the app doesn't ask again. The layout leaves its own tags and the account
   * check out on these routes. Not part of upstream.
   */

  /** Hard mode (/hard-word-test): reading and meaning, its own tags and card */
  export let hard = false;

  // Prerendered pages don't know their origin: without VITE_BASE_PATH or VITE_HTTPS_URL
  // the tags are set in the browser.
  const siteOrigin = basePath || (browser ? window.location.origin : '');
  const title = tr(hard ? 'hardTest.ogTitle' : 'wordTest.ogTitle');
  const description = tr(hard ? 'hardTest.ogDescription' : 'wordTest.ogDescription');
  const path = hard ? '/hard-word-test' : '/word-test';
  const image = siteOrigin ? `${siteOrigin}${pagePath}${path}-card.png` : '';
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="robots" content="index,follow" />
  <meta name="description" content={description} />
  {#if siteOrigin}
    <link rel="canonical" href="{siteOrigin}{pagePath}{path}" />
  {/if}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  {#if image}
    <meta name="twitter:image" content={image} />
  {/if}
  <meta name="twitter:image:alt" content={title} />
  {#if siteOrigin}
    <meta property="og:url" content="{siteOrigin}{pagePath}{path}" />
  {/if}
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  {#if image}
    <meta property="og:image" content={image} />
    <meta property="og:image:alt" content={title} />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
  {/if}
</svelte:head>

<header class="word-test-bar">
  <a href="{pagePath}/manage" class="word-test-logo" title="Chimimouryou">
    <AppHeaderLogo label="Chimimouryou" />
  </a>
</header>

<div class="app-page-shell">
  <PlacementTest shared {hard} />
</div>

<style>
  .word-test-bar {
    position: fixed;
    inset: 0 0 auto;
    z-index: 40;
    display: flex;
    height: 3.25rem;
    align-items: center;
    padding: 0 1rem;
    border-bottom: 1px solid var(--app-header-border);
    background: var(--background-color);
  }

  @media (min-width: 768px) {
    .word-test-bar {
      padding: 0 2rem;
    }
  }

  .word-test-logo {
    display: flex;
    color: var(--accent-color);
  }
</style>
