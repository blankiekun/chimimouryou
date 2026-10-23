<script lang="ts">
  /** The cover of a friend's book you don't have: its title in white on an avatar colour. */
  export let title: string;
  export let colour = 1;
  /** "Reading something": a hidden book, grey */
  export let muted = false;
  /** Thumbnail size: only the first character */
  export let small = false;
</script>

<span
  class="title-card"
  class:title-card-small={small}
  class:title-card-muted={muted}
  style:--title-card-bg="var(--avatar-{colour})"
  lang={muted ? undefined : 'ja'}
>
  <span class="title-card-text">{small ? [...title][0] : title}</span>
  {#if !small}<span class="title-card-rule" aria-hidden="true" />{/if}
</span>

<style>
  .title-card {
    display: flex;
    width: 100%;
    aspect-ratio: 375 / 529;
    flex-direction: column;
    justify-content: space-between;
    padding: 0.75rem;
    background: var(--title-card-bg);
    color: var(--avatar-text);
  }

  .title-card-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    font-size: var(--type-body);
    font-weight: 700;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .title-card-rule {
    width: 1.25rem;
    height: 2px;
    background: currentColor;
  }

  .title-card-muted {
    background: var(--surface-color);
    color: var(--app-muted-fg);
  }

  .title-card-small {
    align-items: center;
    justify-content: center;
    padding: 0;
  }
</style>
