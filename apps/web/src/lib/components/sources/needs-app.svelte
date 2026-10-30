<script lang="ts">
  import { desktopAppUrl } from '$lib/data/env';
  import { needsAppMessage } from '$lib/data/sources/transport';

  /**
   * Standalone in a plain browser: a site that doesn't allow CORS (board 5s/7s). A quiet state
   * with the way out, never an error.
   */
</script>

<div class="needs-app">
  <p class="needs-app-line">
    <span class="needs-app-swatch" aria-hidden="true"></span>{needsAppMessage}
  </p>
  <a class="app-button-quiet" href={desktopAppUrl} target="_blank" rel="noreferrer"
    >Get the desktop app</a
  >
</div>

<style>
  .needs-app {
    display: grid;
    justify-items: start;
    gap: 0.25rem;
  }

  .needs-app-line {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .needs-app-swatch {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    background: currentColor;
  }
</style>
