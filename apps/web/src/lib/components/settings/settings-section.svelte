<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import { findSettingsSection, getSettingsView } from './settings-sections';
  import { t$ } from '$lib/i18n';

  /** Id from settings-sections.ts; title, description and order come from there. */
  export let id: string;
  /** Extra words the settings search should match for content without items */
  export let keywords = '';
  /** Single column, for editors and lists */
  export let wide = false;
  /** Shown after the title, e.g. the number of themes */
  export let count: number | undefined = undefined;

  const view = getSettingsView();
  const info = findSettingsSection(id);

  $: visible = !$view || !!$view.query.trim() || $view.area === info?.area;
</script>

{#if visible && info}
  <section
    {id}
    class="settings-section"
    style:order={info.order}
    data-settings-section
    data-settings-search="{$t$(info.label)} {$t$(info.description)} {keywords}"
    aria-labelledby="{id}-heading"
  >
    <header class="settings-section-header">
      <SectionHead id="{id}-heading" number={info.number} title={$t$(info.label)} {count} />
      <p>{$t$(info.description)}</p>
    </header>
    <div class="settings-section-grid" class:settings-section-grid-wide={wide}>
      <slot />
    </div>
  </section>
{/if}

<style>
  .settings-section {
    display: grid;
    min-width: 0;
    scroll-margin-top: 5.5rem;
  }

  .settings-section-header {
    padding-bottom: 0.25rem;
  }

  .settings-section-header p {
    margin-top: 0.4rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  /* A single column of rows (settings-item-group.svelte); "wide" sections hold editors. */
  .settings-section-grid {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .settings-section-grid-wide {
    padding-top: 1rem;
  }
</style>
