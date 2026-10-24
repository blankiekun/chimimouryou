<script lang="ts">
  import { browser } from '$app/environment';
  import AppHeaderLogo from '$lib/components/app-header/app-header-logo.svelte';
  import PlacementTest from '$lib/components/placement/placement-test.svelte';
  import { basePath, pagePath } from '$lib/data/env';
  import { tr } from '$lib/i18n';
  import { MetaTags } from 'svelte-meta-tags';

  /**
   * The public word test, to share on social media: the placement check for someone who has
   * never opened the app (no header tabs, no first run, no sign-in), with prerendered Open
   * Graph tags. The result is saved like the in-app check's, so the app doesn't ask again.
   * The layout leaves its own tags and the account check out on this route. Not part of upstream.
   */

  // Prerendered pages don't know their origin: without VITE_BASE_PATH the tags are set in the browser.
  const siteOrigin = basePath || (browser ? window.location.origin : '');
  const title = tr('wordTest.ogTitle');
  const description = tr('wordTest.ogDescription');
  const image = siteOrigin
    ? [
        {
          url: `${siteOrigin}${pagePath}/word-test-card.png`,
          width: 1200,
          height: 630,
          alt: title
        }
      ]
    : [];
</script>

<MetaTags
  {title}
  {description}
  canonical={siteOrigin ? `${siteOrigin}${pagePath}/word-test` : undefined}
  openGraph={{ type: 'website', title, description, images: image }}
  twitter={{
    cardType: 'summary_large_image',
    title,
    description,
    image: image[0]?.url,
    imageAlt: title
  }}
/>

<header class="word-test-bar">
  <a href="{pagePath}/manage" class="word-test-logo" title="Chimimouryou">
    <AppHeaderLogo label="Chimimouryou" />
  </a>
</header>

<div class="app-page-shell">
  <PlacementTest shared />
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
